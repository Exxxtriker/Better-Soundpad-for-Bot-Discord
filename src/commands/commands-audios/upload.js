const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
    MAX_AUDIO_BYTES,
    SUPPORTED_AUDIO_EXTENSIONS,
    resolveInside,
    sanitizeBaseName,
} = require('../../utils/audioFiles');
const { saveAudioMetadata } = require('../../utils/audioMetadata');
const { isBotOwner } = require('../../utils/botOwners');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uploadaudio')
        .setDescription('Envia um arquivo de áudio para a pasta do bot.')
        .addAttachmentOption((option) => option.setName('arquivo')
            .setDescription('Arquivo de áudio (.mp3, .ogg, .wav)')
            .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
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

            const attachment = interaction.options.getAttachment('arquivo');
            const ext = path.extname(attachment.name).toLowerCase();

            if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
                return interaction.reply({ content: '❌ Apenas arquivos de áudio (.mp3, .ogg, .wav) são permitidos!', flags: 64 });
            }

            if (!attachment.contentType?.startsWith('audio/') || attachment.size > MAX_AUDIO_BYTES) {
                return interaction.reply({
                    content: '❌ O arquivo deve ser um áudio válido de até 25 MB.',
                    flags: 64,
                });
            }

            await interaction.deferReply({ flags: 64 });

            const audioFolderPath = path.join(__dirname, 'audios');
            await fs.promises.mkdir(audioFolderPath, { recursive: true });

            const displayName = sanitizeBaseName(path.basename(attachment.name, ext));
            const safeName = `Outros-${displayName}${ext}`;
            const filePath = resolveInside(audioFolderPath, safeName);
            const response = await axios.get(attachment.url, {
                responseType: 'arraybuffer',
                timeout: 30_000,
                maxContentLength: MAX_AUDIO_BYTES,
                maxBodyLength: MAX_AUDIO_BYTES,
            });
            try {
                await fs.promises.writeFile(filePath, response.data, { flag: 'wx' });
            } catch (writeError) {
                if (writeError.code === 'EEXIST') {
                    return interaction.editReply('❌ Já existe um áudio com esse nome.');
                }
                throw writeError;
            }
            try {
                saveAudioMetadata(audioFolderPath, `Outros-${displayName}`, {
                    source: 'discord',
                    sourceChannel: interaction.channel?.name
                        ? `#${interaction.channel.name}`
                        : 'Canal do Discord',
                });
            } catch (metadataError) {
                await fs.promises.unlink(filePath).catch(() => {});
                throw metadataError;
            }

            return interaction.editReply({
                content: `✅ O áudio **${displayName}${ext}** foi salvo na categoria **Outros**!`,
            });
        } catch (error) {
            console.error('Erro ao salvar o áudio:', error);
            const response = { content: `❌ ${error.message || 'Não foi possível salvar o áudio.'}` };
            if (interaction.deferred || interaction.replied) return interaction.editReply(response);
            return interaction.reply({ ...response, flags: 64 });
        }
    },
};
