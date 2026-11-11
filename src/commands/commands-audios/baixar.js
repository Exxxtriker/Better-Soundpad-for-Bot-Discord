/* eslint-disable max-len */
/**
 * This command uses yt-dlp
 * Copyright (c) 2019-2024 yt-dlp developers
 * Repository: https://github.com/yt-dlp/yt-dlp
 * License: The Unlicense
 */
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
    MAX_AUDIO_DURATION_SECONDS,
    MAX_DOWNLOADED_AUDIO_BYTES,
    resolveInside,
    sanitizeBaseName,
    validateYouTubeUrl,
} = require('../../utils/audioFiles');
const { saveAudioMetadata } = require('../../utils/audioMetadata');
const { isBotOwner } = require('../../utils/botOwners');

const execFileAsync = promisify(execFile);
const activeDownloads = new Set();

function parseDownloadMetadata(output) {
    return String(output || '').split(/\r?\n/).reduce((metadata, line) => {
        if (metadata || !line.trim().startsWith('{')) return metadata;
        try {
            const parsed = JSON.parse(line);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }, null);
}

function resolveDownloadedAudioPath(metadata, expectedPath, audioFolderPath) {
    if (!metadata?.filepath) return expectedPath;
    const candidate = path.resolve(metadata.filepath);
    const expectedFolder = path.resolve(audioFolderPath);
    const isSafeAudioPath = path.dirname(candidate) === expectedFolder
        && path.extname(candidate).toLowerCase() === '.mp3';
    return isSafeAudioPath ? candidate : expectedPath;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ytmp3')
        .setDescription('Baixa um vídeo do YouTube e salva como .mp3')
        .addStringOption((option) => option.setName('nome')
            .setDescription('Nome do arquivo de saída (sem extensão)')
            .setRequired(true))
        .addStringOption((option) => option.setName('tipo')
            .setDescription('Tipo de áudio')
            .setRequired(true)
            .addChoices(
                { name: 'SoundEffects', value: 'SoundEffects' },
                { name: 'SoundTrack', value: 'SoundTrack' },
                { name: 'Music', value: 'Music' },
            ))
        .addStringOption((option) => option.setName('url')
            .setDescription('URL do vídeo do YouTube')
            .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        let downloadKey;
        let downloadReserved = false;
        try {
            if (!isBotOwner(interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Este comando é restrito aos donos do bot.',
                    flags: 64,
                });
            }

            if (!interaction.inGuild()) {
                return interaction.reply({
                    content: '❌ Este comando só pode ser usado dentro de um servidor.',
                    flags: 64,
                });
            }

            const nome = sanitizeBaseName(interaction.options.getString('nome'));
            const tipo = interaction.options.getString('tipo');
            const url = validateYouTubeUrl(interaction.options.getString('url'));
            const fileName = `${tipo}-${nome}`;

            await interaction.deferReply({ flags: 64 });
            await interaction.editReply({ content: '🎶 Baixando e convertendo, aguarde...' });

            const audioFolderPath = path.join(__dirname, 'audios');
            await fs.promises.mkdir(audioFolderPath, { recursive: true });

            const outputTemplate = resolveInside(audioFolderPath, `${fileName}.%(ext)s`);
            const finalPath = resolveInside(audioFolderPath, `${fileName}.mp3`);
            downloadKey = finalPath.toLowerCase();
            if (fs.existsSync(finalPath) || activeDownloads.has(downloadKey)) {
                return interaction.editReply({ content: '❌ Já existe um áudio com esse nome ou ele já está sendo baixado.' });
            }
            activeDownloads.add(downloadKey);
            downloadReserved = true;

            const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
            const cookiesPath = path.join(__dirname, 'cookies.txt');
            if (!fs.existsSync(ytDlpPath)) throw new Error('O executável yt-dlp.exe não foi encontrado.');
            const args = [
                '--extractor-args',
                'youtube:player_client=android',
                '--user-agent',
                'Mozilla/5.0',
                '-x',
                '-f', 'bestaudio/best',
                '--audio-format', 'mp3',
                '--no-playlist',
                '--no-overwrites',
                '--max-filesize', '250M',
                '--match-filter', `duration <= ${MAX_AUDIO_DURATION_SECONDS}`,
                '--quiet',
                '--no-warnings',
                '--no-simulate',
                '--print', 'after_move:{"channel":%(channel)j,"filepath":%(filepath)j}',
                '-o',
                outputTemplate,
                url,
            ];

            if (fs.existsSync(cookiesPath)) args.unshift('--cookies', cookiesPath);

            const { stdout, stderr } = await execFileAsync(ytDlpPath, args, {
                timeout: 10 * 60 * 1000,
                maxBuffer: 1024 * 1024,
                windowsHide: true,
            });
            const downloadMetadata = parseDownloadMetadata(stdout);
            const downloadedPath = resolveDownloadedAudioPath(
                downloadMetadata,
                finalPath,
                audioFolderPath,
            );

            if (!fs.existsSync(downloadedPath)) {
                console.error('O yt-dlp terminou sem gerar o arquivo esperado.', {
                    expectedPath: finalPath,
                    reportedPath: downloadMetadata?.filepath,
                    output: stdout,
                    details: stderr,
                    limits: 'Duração máxima de 2 horas e download máximo de 250 MB.',
                });
                return interaction.editReply({
                    content: '❌ O vídeo não gerou um áudio. Confira os limites de **2 horas** e **250 MB**.',
                });
            }

            const downloadedStats = await fs.promises.stat(downloadedPath);
            if (downloadedStats.size > MAX_DOWNLOADED_AUDIO_BYTES) {
                await fs.promises.unlink(downloadedPath);
                return interaction.editReply({ content: '❌ O áudio convertido ultrapassou 250 MB.' });
            }

            if (downloadedPath !== finalPath) await fs.promises.rename(downloadedPath, finalPath);
            const sourceChannel = downloadMetadata?.channel;
            saveAudioMetadata(audioFolderPath, fileName, {
                source: 'youtube',
                sourceChannel: sourceChannel && sourceChannel !== 'NA'
                    ? sourceChannel
                    : 'Canal não identificado',
            });

            return interaction.editReply({
                content: `✅ Áudio salvo como **${fileName}.mp3**`,
            });
        } catch (err) {
            console.error('Erro ao processar:', err);
            const acknowledged = interaction.deferred || interaction.replied;
            const response = {
                content: acknowledged
                    ? '❌ Falha ao baixar o áudio. Confira a URL e os limites de 2 horas e 250 MB.'
                    : `❌ ${err.message || 'Não foi possível processar o vídeo.'}`,
            };
            if (acknowledged) return interaction.editReply(response).catch(() => {});
            return interaction.reply({ ...response, flags: 64 });
        } finally {
            if (downloadReserved) activeDownloads.delete(downloadKey);
        }
    },
    parseDownloadMetadata,
    resolveDownloadedAudioPath,
};
