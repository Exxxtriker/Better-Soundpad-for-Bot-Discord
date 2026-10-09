/* eslint-disable max-len */
const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField,
} = require('discord.js');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType,
} = require('@discordjs/voice');
const { SpotifyPlugin } = require('@distube/spotify');
const { execFile, spawn } = require('child_process');
const path = require('path');
const { PassThrough } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const activePlayers = require('../../handlers/activePlayers');
const { writeErrorLog } = require('../../utils/errorLogger');
const { safelyDestroyVoiceConnection } = require('../../utils/voiceConnection');
const { createVoiceSessionGuard } = require('../../utils/voiceSessionGuard');

const YT_DLP_PATH = path.join(__dirname, '../commands-audios/yt-dlp.exe');
const COOKIES_PATH = path.join(__dirname, '../commands-audios/cookies.txt');
const STREAM_URL_MAX_AGE = 4 * 60 * 60 * 1000;
const DIRECT_STREAM_START_TIMEOUT = 8_000;
const FALLBACK_STREAM_START_TIMEOUT = 20_000;
const STREAM_BUFFER_SIZE = 512 * 1024;
const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2;
const SPOTIFY_SEARCH_LIMIT = 8;
const SPOTIFY_CANDIDATE_ATTEMPTS = 4;
const SPOTIFY_SOURCE_RECOVERY_ATTEMPTS = 2;
const DEFAULT_MUSIC_VOLUME = 100;
const MAX_MUSIC_QUEUE_SIZE = 1_000;
const MAX_VOICE_STATUS_LENGTH = 500;

// ─── Fila por guild ───────────────────────────────────────────────
const guildQueues = new Map(); // guildId -> { songs[], player, connection, playing }
const playerMessages = new Map(); // guildId -> Message
const playerMessageDeleteListeners = new Map(); // guildId -> { client, listener }
const pendingPlayRequests = new Map(); // guildId -> quantidade de /play em processamento
const pendingQueueCreations = new Map(); // guildId -> { voiceChannelId, promise }
let spotifyPlugin = null;
let spotifyPublicPlugin = null;

function beginPlayRequest(guildId) {
    pendingPlayRequests.set(guildId, (pendingPlayRequests.get(guildId) ?? 0) + 1);
}

function endPlayRequest(guildId) {
    const remaining = (pendingPlayRequests.get(guildId) ?? 1) - 1;
    if (remaining > 0) pendingPlayRequests.set(guildId, remaining);
    else pendingPlayRequests.delete(guildId);
}

function clearPlayerMessage(guildId, expectedMessageId) {
    const currentMessage = playerMessages.get(guildId);
    if (expectedMessageId && currentMessage?.id !== expectedMessageId) return false;

    playerMessages.delete(guildId);
    const registration = playerMessageDeleteListeners.get(guildId);
    if (registration) {
        registration.client.removeListener('messageDelete', registration.listener);
        playerMessageDeleteListeners.delete(guildId);
    }
    return Boolean(currentMessage || registration);
}

async function closePlayerMessage(guildId) {
    const message = playerMessages.get(guildId);
    if (!message) return;
    clearPlayerMessage(guildId, message.id);
    try {
        await message.delete();
    } catch (error) {
        if (error.code === 10008) return;
        console.error('Erro ao remover o menu de música:', error);
        await message.edit({ components: [] }).catch((editError) => {
            if (editError.code !== 10008) console.error('Erro ao desativar o menu de música:', editError);
        });
    }
}

function registerPlayerMessage(guildId, message, client) {
    clearPlayerMessage(guildId);
    playerMessages.set(guildId, message);

    const listener = (deletedMessage) => {
        if (deletedMessage.id === message.id) clearPlayerMessage(guildId, message.id);
    };
    playerMessageDeleteListeners.set(guildId, { client, listener });
    client.on('messageDelete', listener);
}

function formatDuration(seconds) {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getSongPlatform(songOrInfo = {}) {
    if (songOrInfo.platform) return songOrInfo.platform;
    const source = [
        songOrInfo.extractor,
        songOrInfo.extractor_key,
        songOrInfo.url,
        songOrInfo.webpage_url,
    ].filter(Boolean).join(' ').toLowerCase();
    if (source.includes('soundcloud')) return 'SoundCloud';
    if (source.includes('spotify')) return 'Spotify';
    return 'YouTube';
}

function detectMusicPlatform(query) {
    if (!/^https:\/\//i.test(query)) return 'YouTube';
    const hostname = new URL(query).hostname.toLowerCase();
    if (hostname.includes('spotify.com')) return 'Spotify';
    if (hostname.includes('soundcloud.com')) return 'SoundCloud';
    return 'YouTube';
}

const PLATFORM_EMOJIS = Object.freeze({
    YouTube: '<:YouTube:1547054428962689105>',
    Spotify: '<:Spotify:1547054692155269181>',
    SoundCloud: '<:Soundcloud:1547054864083714100>',
});

function getPlatformIcon(song) {
    return PLATFORM_EMOJIS[getSongPlatform(song)] ?? '🎵';
}

function isPlaylistUrl(query) {
    if (!/^https:\/\//i.test(query)) return false;
    const parsed = new URL(query);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) {
        return parsed.pathname === '/playlist' || Boolean(parsed.searchParams.get('list'));
    }
    if (hostname.includes('soundcloud.com')) return parsed.pathname.split('/').includes('sets');
    return false;
}

function getLoopMode(customMode, repeatMode = 0) {
    if (customMode) return customMode;
    return ['off', 'song', 'queue'][repeatMode] ?? 'off';
}

function validateQuery(query) {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200) {
        throw new Error('Use uma busca entre 1 e 200 caracteres.');
    }

    if (!/^https?:\/\//i.test(trimmed)) return trimmed;

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('URL inválida.');
    }

    const allowedHosts = [
        'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
        'spotify.com', 'open.spotify.com', 'soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com',
    ];
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
        throw new Error('Apenas links HTTPS do YouTube, Spotify e SoundCloud são aceitos.');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) {
        const playlistId = parsed.searchParams.get('list');
        if (playlistId !== null) {
            if (!/^[A-Za-z0-9_-]{2,128}$/.test(playlistId)) {
                throw new Error('O identificador da playlist do YouTube é inválido.');
            }
            const videoId = hostname === 'youtu.be'
                ? parsed.pathname.split('/').filter(Boolean)[0]
                : parsed.searchParams.get('v');
            if (videoId) {
                return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(playlistId)}`;
            }
            return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
        }
    }
    if (hostname === 'youtu.be') {
        const videoId = parsed.pathname.split('/').filter(Boolean)[0];
        if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }

    if (hostname.endsWith('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }

    return parsed.toString();
}

function stopProcesses(queue) {
    queue?.currentProcesses?.cancel?.();
    queue?.currentProcesses?.ytdlp?.kill();
    queue?.currentProcesses?.ffmpeg?.kill();
    if (queue) queue.currentProcesses = null;
}

function handleAudioPlayerError(error) {
    console.error('Erro no player de áudio:', error);
}

function createVoiceChannelStatus(song) {
    const title = song?.title ?? song?.name ?? 'Música desconhecida';
    const duration = song?.formattedDuration
        ?? (Number.isFinite(song?.duration) ? formatDuration(song.duration) : null);
    return [
        `Tocando agora: ${title}`,
        duration,
    ].filter(Boolean).join(' • ').slice(0, MAX_VOICE_STATUS_LENGTH);
}

async function setVoiceChannelStatus(voiceChannel, status) {
    if (!voiceChannel?.client?.rest || !voiceChannel.id) return false;
    if (typeof voiceChannel.client.isReady === 'function' && !voiceChannel.client.isReady()) return false;

    try {
        await voiceChannel.client.rest.put(`/channels/${voiceChannel.id}/voice-status`, {
            body: { status: status?.slice(0, MAX_VOICE_STATUS_LENGTH) ?? null },
        });
        return true;
    } catch (error) {
        console.error('Erro ao atualizar o status da call:', error);
        return false;
    }
}

async function dismissReply(interaction) {
    await interaction.deleteReply().catch((error) => {
        console.error('Não foi possível remover a confirmação do comando:', error);
    });
}

function getFirstMediaEntry(info) {
    if (!Array.isArray(info?.entries)) return info;
    return info.entries.find((entry) => entry && typeof entry === 'object') ?? info;
}

function getSelectedStreamData(info) {
    const mediaInfo = getFirstMediaEntry(info);
    const requestedAudio = mediaInfo.requested_downloads?.find((format) => format?.url);
    const mergedAudio = mediaInfo.requested_formats?.find(
        (format) => format?.url && format.acodec !== 'none',
    );
    const availableAudio = mediaInfo.formats?.findLast?.(
        (format) => format?.url && format.acodec !== 'none',
    );
    const selectedFormat = requestedAudio ?? mergedAudio ?? availableAudio ?? mediaInfo;
    const streamUrl = selectedFormat.url ?? mediaInfo.url;
    if (!streamUrl) throw new Error('A plataforma não retornou uma URL de áudio reproduzível.');

    return {
        streamUrl,
        httpHeaders: selectedFormat.http_headers ?? mediaInfo.http_headers ?? {},
    };
}

function normalizeMatchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getMatchTokens(value) {
    const ignored = new Set(['official', 'audio', 'video', 'music', 'lyrics', 'remaster', 'hd']);
    return normalizeMatchText(value)
        .split(' ')
        .filter((token) => token.length > 1 && !ignored.has(token));
}

function scoreYouTubeCandidate(candidate, song) {
    const title = normalizeMatchText(song.title);
    const artist = normalizeMatchText(song.uploader);
    const candidateTitle = normalizeMatchText(candidate.title);
    const candidateArtist = normalizeMatchText(candidate.uploader ?? candidate.channel);
    const candidateText = `${candidateTitle} ${candidateArtist}`;
    let score = 0;

    if (title && candidateTitle.includes(title)) score += 30;
    if (artist && candidateText.includes(artist)) score += 24;
    getMatchTokens(song.title).forEach((token) => {
        if (candidateTitle.includes(token)) score += 5;
    });
    getMatchTokens(song.uploader).forEach((token) => {
        if (candidateText.includes(token)) score += 4;
    });

    const expectedDuration = Number(song.duration);
    const candidateDuration = Number(candidate.duration);
    if (expectedDuration > 0 && candidateDuration > 0) {
        const difference = Math.abs(expectedDuration - candidateDuration);
        if (difference <= 3) score += 18;
        else if (difference <= 10) score += 10;
        else if (difference <= 30) score += 3;
        else if (difference >= 90) score -= 16;
    }

    const unwanted = ['cover', 'karaoke', 'instrumental', 'slowed', 'sped up', 'nightcore', 'remix', 'live'];
    unwanted.forEach((term) => {
        if (candidateTitle.includes(term) && !title.includes(term)) score -= 9;
    });
    return score;
}

function getYouTubeCandidateUrl(candidate) {
    const url = candidate.webpage_url ?? candidate.original_url ?? candidate.url;
    if (/^https:\/\//i.test(url ?? '')) return url;
    const videoId = candidate.id ?? (/^[\w-]{11}$/.test(url ?? '') ? url : null);
    return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
}

function getMediaSourceKey(source) {
    try {
        const parsed = new URL(source);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'youtu.be') {
            return `youtube:${parsed.pathname.split('/').filter(Boolean)[0] ?? source}`;
        }
        if (hostname.endsWith('youtube.com')) {
            return `youtube:${parsed.searchParams.get('v') ?? source}`;
        }
        return parsed.toString();
    } catch {
        return String(source ?? '');
    }
}

function isRecoverableStreamError(error) {
    const details = [error?.message, error?.details, error?.cause?.message]
        .filter(Boolean)
        .join('\n');
    return /(?:HTTP Error 403|\b403 Forbidden\b|bytes read, .* more expected|premature close|ECONNRESET|ETIMEDOUT|socket hang up)/i
        .test(details);
}

function buildFfmpegHeaders(headers = {}) {
    return Object.entries(headers)
        .filter(([name, value]) => name && typeof value === 'string' && !/[\r\n]/.test(`${name}${value}`))
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('');
}

function isDecodedAudioComplete(song, decodedBytes) {
    const expectedDuration = Number(song?.duration);
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) return false;
    const decodedDuration = decodedBytes / PCM_BYTES_PER_SECOND;
    const allowedDifference = Math.max(5, expectedDuration * 0.03);
    return decodedDuration >= expectedDuration - allowedDifference;
}

function createYtDlpError(error, stderr = '') {
    const details = [stderr, error?.stderr, error?.message]
        .filter(Boolean)
        .join('\n');
    const attachDetails = (targetError) => {
        const normalizedDetails = details.trim();
        if (normalizedDetails) targetError.details = normalizedDetails.slice(-4_000);
        return targetError;
    };

    if (/sign in to confirm your age/i.test(details)) {
        const authError = new Error(
            'O YouTube exige uma conta autenticada e apta a confirmar a idade para este vídeo.',
        );
        authError.code = 'YOUTUBE_AGE_AUTH_REQUIRED';
        return attachDetails(authError);
    }

    if (/video is unavailable|video unavailable|has been removed/i.test(details)) {
        const unavailableError = new Error('Este vídeo do YouTube está indisponível ou foi removido.');
        unavailableError.code = 'YOUTUBE_UNAVAILABLE';
        return attachDetails(unavailableError);
    }

    const errorLine = details
        .split(/\r?\n/)
        .find((line) => /^ERROR:/i.test(line.trim()));
    const ytDlpError = new Error(
        errorLine?.trim().replace(/^ERROR:\s*/i, '')
        ?? 'O yt-dlp não conseguiu carregar o áudio.',
    );
    ytDlpError.code = error?.code ?? 'YT_DLP_ERROR';
    return attachDetails(ytDlpError);
}

function parseYtDlpJson(stdout, fallbackMessage) {
    const output = String(stdout ?? '').replace(/^\uFEFF/, '').trim();
    if (!output) {
        const emptyOutputError = new Error('O extrator não retornou informações da faixa.');
        emptyOutputError.code = 'MEDIA_EMPTY_OUTPUT';
        throw emptyOutputError;
    }

    const candidates = [
        output,
        ...output.split(/\r?\n/).map((line) => line.trim()).reverse(),
    ];
    const firstBrace = output.indexOf('{');
    const lastBrace = output.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(output.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
        if (candidate.startsWith('{') && candidate.endsWith('}')) {
            try {
                return JSON.parse(candidate);
            } catch {
                // Continua procurando uma linha JSON válida.
            }
        }
    }

    const invalidOutputError = new Error(fallbackMessage);
    invalidOutputError.code = 'MEDIA_INVALID_JSON';
    throw invalidOutputError;
}

// ─── Pega info da música via yt-dlp ──────────────────────────────
function getSongInfo(query, options = {}) {
    return new Promise((resolve, reject) => {
        const { useCookies = true, timeoutMs = 60_000 } = options;
        const input = /^https:\/\//i.test(query) ? query : `ytsearch1:${query}`;
        const cookieArgs = useCookies ? ['--cookies', COOKIES_PATH] : [];
        execFile(YT_DLP_PATH, [
            '--ignore-config',
            ...cookieArgs,
            '--js-runtimes', `node:${process.execPath}`,
            '-f', 'bestaudio/best',
            '--dump-single-json',
            '--no-warnings',
            '--quiet',
            '--no-playlist',
            input,
        ], { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(createYtDlpError(error, stderr));
            let info;
            try {
                const parsed = parseYtDlpJson(stdout, 'O extrator retornou dados inválidos para a música.');
                info = getFirstMediaEntry(parsed);
            } catch (parseError) {
                return reject(parseError);
            }
            try {
                const streamData = getSelectedStreamData(info);
                return resolve({
                    title: info.title ?? 'Desconhecido',
                    duration: info.duration ?? 0,
                    thumbnail: info.thumbnail ?? null,
                    url: info.webpage_url ?? query,
                    uploader: info.uploader ?? 'Desconhecido',
                    platform: getSongPlatform(info),
                    formattedDuration: formatDuration(info.duration ?? 0),
                    ...streamData,
                    resolvedAt: Date.now(),
                    user: null, // preenchido depois
                });
            } catch (streamError) {
                return reject(streamError);
            }
        });
    });
}

function searchYouTubeCandidates(query, options = {}) {
    const {
        limit = SPOTIFY_SEARCH_LIMIT,
        execute = execFile,
    } = options;
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
    return new Promise((resolve, reject) => {
        execute(YT_DLP_PATH, [
            '--ignore-config',
            '--js-runtimes', `node:${process.execPath}`,
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            '--quiet',
            `ytsearch${safeLimit}:${query}`,
        ], { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(createYtDlpError(error, stderr));
            try {
                const parsed = parseYtDlpJson(stdout, 'A busca ampliada retornou dados inválidos.');
                const entries = Array.isArray(parsed.entries) ? parsed.entries : [parsed];
                return resolve(entries.filter((entry) => getYouTubeCandidateUrl(entry)));
            } catch (parseError) {
                return reject(parseError);
            }
        });
    });
}

async function resolveSpotifyPlayback(song, helpers = {}) {
    const search = helpers.search ?? searchYouTubeCandidates;
    const resolveCandidate = helpers.resolveCandidate ?? getSongInfo;
    const query = `${song.title} ${song.uploader}`.trim();
    const candidates = await search(query, { limit: SPOTIFY_SEARCH_LIMIT });
    const failedSources = new Set(song.failedStreamSources ?? []);
    const ranked = candidates
        .map((candidate) => ({
            candidate,
            url: getYouTubeCandidateUrl(candidate),
            score: scoreYouTubeCandidate(candidate, song),
        }))
        .filter((item) => item.url && !failedSources.has(getMediaSourceKey(item.url)))
        .sort((left, right) => right.score - left.score);

    let lastError = null;
    const attempts = ranked.slice(0, SPOTIFY_CANDIDATE_ATTEMPTS);
    const tryCandidate = async (index) => {
        if (index >= attempts.length) return null;
        try {
            const item = attempts[index];
            return await resolveCandidate(item.url, { useCookies: false, timeoutMs: 20_000 });
        } catch (error) {
            lastError = error;
            return tryCandidate(index + 1);
        }
    };
    const resolved = await tryCandidate(0);
    if (resolved) return resolved;

    try {
        const finalCandidate = await resolveCandidate(`${query} official audio`, {
            useCookies: false,
            timeoutMs: 30_000,
        });
        if (failedSources.has(getMediaSourceKey(finalCandidate.url))) {
            const repeatedSourceError = new Error(
                'A busca retornou novamente uma fonte de áudio que já havia falhado.',
            );
            repeatedSourceError.code = 'SPOTIFY_REPEATED_SOURCE';
            throw repeatedSourceError;
        }
        return finalCandidate;
    } catch (error) {
        lastError = error;
    }
    throw lastError ?? new Error('Nenhum resultado reproduzível foi encontrado para esta faixa do Spotify.');
}

function createPlaylistQueueSongs(info, user, sourceQuery) {
    const entries = Array.isArray(info.entries) ? info.entries : [];
    if (entries.length > MAX_MUSIC_QUEUE_SIZE) {
        throw new Error(`A playlist possui mais de ${MAX_MUSIC_QUEUE_SIZE} faixas.`);
    }

    const platform = getSongPlatform({ ...info, url: sourceQuery });
    const songs = entries.map((entry) => {
        let url = entry.webpage_url ?? entry.original_url ?? entry.url;
        if (platform === 'YouTube' && !/^https:\/\//i.test(url ?? '') && entry.id) {
            url = `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`;
        }
        if (!/^https:\/\//i.test(url ?? '')) return null;
        const uploader = entry.uploader ?? entry.channel ?? info.uploader ?? 'Desconhecido';
        const duration = Number.isFinite(entry.duration) ? entry.duration : 0;
        return {
            title: entry.title ?? 'Faixa desconhecida',
            duration,
            formattedDuration: formatDuration(duration),
            thumbnail: entry.thumbnail ?? entry.thumbnails?.at(-1)?.url ?? null,
            url,
            uploader,
            user,
            platform,
            streamQuery: url,
            streamUrl: null,
            httpHeaders: {},
            resolvedAt: 0,
            preserveMetadata: true,
        };
    }).filter(Boolean);
    if (songs.length === 0) throw new Error('A playlist não possui faixas reproduzíveis.');
    return songs;
}

function getPlaylistSongs(query, user) {
    return new Promise((resolve, reject) => {
        const cookieArgs = detectMusicPlatform(query) === 'YouTube'
            ? ['--cookies', COOKIES_PATH]
            : [];
        execFile(YT_DLP_PATH, [
            '--ignore-config',
            ...cookieArgs,
            '--js-runtimes', `node:${process.execPath}`,
            '--yes-playlist',
            '--flat-playlist',
            '--dump-single-json',
            '--playlist-end', String(MAX_MUSIC_QUEUE_SIZE + 1),
            '--no-warnings',
            '--quiet',
            query,
        ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(createYtDlpError(error, stderr));
            let info;
            try {
                info = parseYtDlpJson(stdout, 'O extrator retornou dados inválidos para a playlist.');
            } catch (parseError) {
                return reject(parseError);
            }
            try {
                return resolve(createPlaylistQueueSongs(info, user, query));
            } catch (playlistError) {
                return reject(playlistError);
            }
        });
    });
}

async function resolveSoundCloudUrl(query, fetcher = fetch) {
    if (!new URL(query).hostname.toLowerCase().startsWith('on.soundcloud.com')) return query;
    const response = await fetcher(query, { redirect: 'follow' });
    if (!response.ok) throw new Error(`O link curto do SoundCloud respondeu com status ${response.status}.`);
    const resolved = new URL(response.url);
    if (!resolved.hostname.toLowerCase().endsWith('soundcloud.com')) {
        throw new Error('O link curto não redirecionou para o SoundCloud.');
    }
    return resolved.toString();
}

function createSoundCloudQueueSongs(info, user) {
    const entries = Array.isArray(info.entries) ? info.entries : [info];
    if (entries.length > MAX_MUSIC_QUEUE_SIZE) {
        throw new Error(`A seleção do SoundCloud possui mais de ${MAX_MUSIC_QUEUE_SIZE} faixas.`);
    }

    const songs = entries.map((entry) => {
        const url = entry.webpage_url ?? entry.original_url ?? entry.url;
        if (!/^https:\/\//i.test(url ?? '')) return null;
        let streamData = { streamUrl: null, httpHeaders: {} };
        try {
            streamData = getSelectedStreamData(entry);
        } catch {
            // A URL será resolvida novamente apenas quando esta faixa for tocada.
        }
        const duration = Number.isFinite(entry.duration) ? entry.duration : 0;
        return {
            title: entry.title ?? 'Faixa do SoundCloud',
            duration,
            formattedDuration: formatDuration(duration),
            thumbnail: entry.thumbnail ?? entry.thumbnails?.at(-1)?.url ?? null,
            url,
            uploader: entry.uploader ?? entry.creator ?? 'Artista desconhecido',
            user,
            platform: 'SoundCloud',
            streamQuery: url,
            ...streamData,
            resolvedAt: streamData.streamUrl ? Date.now() : 0,
            preserveMetadata: true,
        };
    }).filter(Boolean);

    if (songs.length === 0) throw new Error('O SoundCloud não retornou faixas reproduzíveis.');
    return songs;
}

async function getSoundCloudSongs(query, user, helpers = {}) {
    const resolveUrl = helpers.resolveUrl ?? resolveSoundCloudUrl;
    const execute = helpers.execFile ?? execFile;
    const resolvedUrl = await resolveUrl(query);
    const personalized = /\/discover\/sets\/personalized-tracks::/i.test(new URL(resolvedUrl).pathname);

    return new Promise((resolve, reject) => {
        const selectionArgs = personalized
            ? ['--playlist-items', '1']
            : ['--playlist-end', String(MAX_MUSIC_QUEUE_SIZE + 1)];
        execute(YT_DLP_PATH, [
            '--ignore-config',
            '--js-runtimes', `node:${process.execPath}`,
            '-f', 'bestaudio/best',
            ...selectionArgs,
            '--dump-single-json',
            '--no-warnings',
            '--quiet',
            resolvedUrl,
        ], { timeout: 120_000, maxBuffer: 25 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(createYtDlpError(error, stderr));
            try {
                const info = parseYtDlpJson(stdout, 'O extrator retornou dados inválidos para o SoundCloud.');
                return resolve(createSoundCloudQueueSongs(info, user));
            } catch (soundCloudError) {
                return reject(soundCloudError);
            }
        });
    });
}

function isSongStreamFresh(song, now = Date.now()) {
    return Boolean(
        song?.streamUrl
        && Number.isFinite(song.resolvedAt)
        && now - song.resolvedAt < STREAM_URL_MAX_AGE,
    );
}

async function resolveSongStream(song, resolver = getSongInfo) {
    if (isSongStreamFresh(song)) return song;
    if (song.streamResolution) return song.streamResolution;

    const resolution = (async () => {
        const requester = song.user;
        const streamInfo = await resolver(song.streamQuery ?? song.url);
        if (song.preserveMetadata) {
            song.streamUrl = streamInfo.streamUrl;
            song.httpHeaders = streamInfo.httpHeaders;
            song.resolvedAt = streamInfo.resolvedAt;
            song.streamQuery = streamInfo.url;
        } else {
            Object.assign(song, streamInfo);
        }
        song.user = requester;
        return song;
    })();

    song.streamResolution = resolution;
    try {
        return await resolution;
    } finally {
        if (song.streamResolution === resolution) delete song.streamResolution;
    }
}

function resolveSongForPlayback(song) {
    const platform = getSongPlatform(song);
    let resolver = getSongInfo;
    if (platform === 'Spotify') resolver = () => resolveSpotifyPlayback(song);
    else if (platform !== 'YouTube') resolver = (query) => getSongInfo(query, { useCookies: false });
    return resolveSongStream(song, resolver);
}

function prefetchNextSong(queue, resolver = null) {
    const nextSong = queue?.songs?.[1];
    if (!nextSong || isSongStreamFresh(nextSong)) return null;
    const resolution = resolver
        ? resolveSongStream(nextSong, resolver)
        : resolveSongForPlayback(nextSong);
    return resolution.catch(() => null);
}

// ─── Stream direto da URL resolvida pelo yt-dlp ──────────────────
function createYtStream(song, spawnProcess = spawn) {
    const headers = buildFfmpegHeaders(song.httpHeaders);
    const inputOptions = headers ? ['-headers', headers] : [];
    const output = new PassThrough({ highWaterMark: STREAM_BUFFER_SIZE });
    const processes = {
        ytdlp: null,
        ffmpeg: null,
        cancelled: false,
        failed: false,
        timers: new Set(),
        setTimer(callback, delay) {
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                callback();
            }, delay);
            timer.unref?.();
            this.timers.add(timer);
            return timer;
        },
        clearTimer(timer) {
            if (!timer) return;
            clearTimeout(timer);
            this.timers.delete(timer);
        },
        cancel() {
            this.cancelled = true;
            this.timers.forEach((timer) => clearTimeout(timer));
            this.timers.clear();
            this.ytdlp?.kill();
            this.ffmpeg?.kill();
        },
    };
    const registerPlaybackFailure = (error) => {
        const playbackError = error instanceof Error ? error : new Error(String(error));
        playbackError.platform ??= getSongPlatform(song);
        playbackError.track ??= String(song?.title ?? song?.name ?? 'Faixa desconhecida');
        const deferLogging = playbackError.platform === 'Spotify'
            && isRecoverableStreamError(playbackError);
        processes.failed = true;
        processes.failure = playbackError;
        processes.failureLogged = !deferLogging;
        if (!deferLogging) {
            console.error(`[${playbackError.platform}] Falha durante a transmissão:`, playbackError);
        }
        return playbackError;
    };
    let directBytes = 0;
    let directError = '';
    let directFinished = false;
    let fallbackStarted = false;
    let directStartTimer = null;

    const startFallback = () => {
        if (fallbackStarted || processes.cancelled) return;
        fallbackStarted = true;
        processes.clearTimer(directStartTimer);
        const streamQuery = song.streamQuery ?? song.url;
        const fallbackInput = /^https:\/\//i.test(streamQuery)
            ? streamQuery
            : `ytsearch1:${streamQuery}`;
        const cookieArgs = detectMusicPlatform(fallbackInput) === 'YouTube'
            ? ['--cookies', COOKIES_PATH]
            : [];

        const ytdlp = spawnProcess(YT_DLP_PATH, [
            '--ignore-config',
            ...cookieArgs,
            '--js-runtimes', `node:${process.execPath}`,
            '-f', 'bestaudio/best',
            '--no-playlist',
            '--socket-timeout', '20',
            '--retries', '8',
            '--fragment-retries', '8',
            '--extractor-retries', '3',
            '--file-access-retries', '3',
            '--retry-sleep', 'http:1',
            '--retry-sleep', 'fragment:1',
            '--no-warnings',
            '--quiet',
            '-o', '-',
            fallbackInput,
        ]);
        const fallbackFfmpeg = spawnProcess(ffmpegPath, [
            '-nostdin',
            '-loglevel', 'error',
            '-re',
            '-i', 'pipe:0',
            '-vn',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1',
        ]);
        let downloadBytes = 0;
        let decodedBytes = 0;
        let downloadExitCode;
        let decoderExitCode;
        let downloadError = '';
        let decoderError = '';
        processes.ytdlp = ytdlp;
        processes.ffmpeg = fallbackFfmpeg;

        const fail = (error) => {
            if (processes.cancelled || processes.failed) return;
            registerPlaybackFailure(error);
            processes.cancel();
            if (!output.destroyed && !output.writableEnded) output.end();
        };
        const fallbackStartTimer = processes.setTimer(() => {
            fail(new Error('O áudio demorou demais para começar no modo compatível.'));
        }, FALLBACK_STREAM_START_TIMEOUT);
        const finishFallback = () => {
            if (
                processes.cancelled
                || downloadExitCode === undefined
                || decoderExitCode === undefined
            ) return;

            const incompleteDownload = downloadExitCode !== 0
                && !isDecodedAudioComplete(song, decodedBytes);
            if (decoderExitCode !== 0 || incompleteDownload) {
                fail(downloadError.includes('ERROR:')
                    ? createYtDlpError(null, downloadError)
                    : new Error(decoderError.trim() || 'O FFmpeg não conseguiu decodificar o áudio.'));
                return;
            }
            if (!output.destroyed && !output.writableEnded) output.end();
        };

        ytdlp.stdout.on('data', (chunk) => {
            downloadBytes += chunk.length;
        });
        ytdlp.stdout.on('error', fail);
        fallbackFfmpeg.stdin.on('error', (error) => {
            if (!processes.cancelled && !processes.failed) {
                console.error('[FFmpeg] Erro ao receber o áudio do extrator:', error);
            }
        });
        fallbackFfmpeg.stdout.once('data', () => {
            processes.clearTimer(fallbackStartTimer);
        });
        fallbackFfmpeg.stdout.on('data', (chunk) => {
            decodedBytes += chunk.length;
        });
        fallbackFfmpeg.stdout.on('error', fail);
        fallbackFfmpeg.stderr.on('data', (data) => {
            decoderError = `${decoderError}${data}`.slice(-4_000);
        });
        fallbackFfmpeg.on('error', fail);
        fallbackFfmpeg.on('close', (code) => {
            if (processes.cancelled) return;
            decoderExitCode = code;
            finishFallback();
        });
        fallbackFfmpeg.stdout.pipe(output, { end: false });
        ytdlp.stdout.pipe(fallbackFfmpeg.stdin);
        ytdlp.stderr.on('data', (data) => {
            downloadError = `${downloadError}${data}`.slice(-4_000);
        });
        ytdlp.on('error', fail);
        ytdlp.on('close', (code) => {
            if (processes.cancelled) return;
            downloadExitCode = code;
            if (code !== 0 && downloadBytes === 0) {
                fail(createYtDlpError(null, downloadError));
            } else if (downloadBytes === 0) {
                fail(new Error('O extrator terminou sem entregar áudio para esta faixa.'));
            } else {
                finishFallback();
            }
        });
    };

    if (song.forceCompatibleStream) {
        startFallback();
        return { stream: output, processes };
    }

    const ffmpeg = spawnProcess(ffmpegPath, [
        '-nostdin',
        '-loglevel', 'error',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_on_network_error', '1',
        '-reconnect_on_http_error', '429,5xx',
        '-reconnect_delay_max', '2',
        '-rw_timeout', '15000000',
        ...inputOptions,
        '-re',
        '-i', song.streamUrl,
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
    ]);
    processes.ffmpeg = ffmpeg;
    directStartTimer = processes.setTimer(() => {
        if (processes.cancelled || directFinished || directBytes > 0) return;
        ffmpeg.kill();
        startFallback();
    }, DIRECT_STREAM_START_TIMEOUT);

    ffmpeg.stdout.on('error', (error) => {
        if (!processes.cancelled) console.error('[FFmpeg] Erro no fluxo de saída:', error);
    });
    ffmpeg.stdout.on('data', (chunk) => {
        directBytes += chunk.length;
        processes.clearTimer(directStartTimer);
    });
    ffmpeg.stdout.pipe(output, { end: false });
    ffmpeg.stderr.on('data', (data) => {
        directError = `${directError}${data}`.slice(-4_000);
    });
    ffmpeg.on('error', (error) => {
        console.error('Falha ao iniciar FFmpeg:', error);
        if (!directFinished && directBytes === 0) startFallback();
    });
    ffmpeg.on('close', (code) => {
        if (directFinished) return;
        directFinished = true;
        if (!processes.cancelled && code !== 0 && directBytes === 0) {
            startFallback();
        } else if (!output.destroyed && !output.writableEnded) {
            if (!processes.cancelled && code !== 0) {
                processes.failed = true;
                const streamError = new Error('A transmissão direta de áudio foi interrompida.');
                streamError.code = `FFMPEG_EXIT_${code}`;
                streamError.platform = getSongPlatform(song);
                streamError.track = String(song?.title ?? song?.name ?? 'Faixa desconhecida');
                if (directError.trim()) streamError.details = directError.trim();
                registerPlaybackFailure(streamError);
            }
            output.end();
        }
    });

    return { stream: output, processes };
}

function createEmbed(guildId) {
    const queue = guildQueues.get(guildId);
    const songs = queue?.songs ?? [];
    const song = songs[0] ?? null;
    const loopMode = getLoopMode(queue?.loop);
    let loopLabel = '`Sem refrão`';
    if (loopMode === 'song') loopLabel = '`Uma balada`';
    if (loopMode === 'queue') loopLabel = '`Toda a jornada`';
    const queueSize = songs.length;
    const requester = song?.user;
    const isPaused = queue?.paused ?? false;
    const volume = queue?.volume ?? DEFAULT_MUSIC_VOLUME;
    const uploader = typeof song?.uploader === 'string' ? song.uploader : song?.uploader?.name;
    let embedColor = 0x2F4F3E;
    if (song) embedColor = isPaused ? 0xC9A227 : 0x7A1F2B;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: '⚜️ GIDEON, O BARDO  •  SALÃO DAS CANÇÕES' });

    if (song) {
        const upcoming = songs.slice(1, 4).map((nextSong, index) => {
            const name = nextSong.title ?? nextSong.name ?? 'Faixa desconhecida';
            return `**${index + 1}.** ${getPlatformIcon(nextSong)} ${name.slice(0, 67)}`;
        });
        const hiddenSongs = Math.max(0, songs.length - 4);
        if (hiddenSongs > 0) upcoming.push(`*e mais ${hiddenSongs} música(s)...*`);

        embed
            .setTitle(`🎻 ${(song.title ?? song.name ?? 'Balada desconhecida').slice(0, 230)}`)
            .setDescription([
                '> *“Que a melodia acompanhe vossa jornada...”*',
                '',
                isPaused ? '⏸️ **A BALADA ESTÁ EM DESCANSO**' : '▶️ **BALADA EM EXECUÇÃO**',
                uploader ? `🪕 Entoada por **${uploader.slice(0, 100)}**` : '🪕 Menestrel desconhecido',
                `${getPlatformIcon(song)} Fonte: **${getSongPlatform(song)}**`,
            ].join('\n'))
            .addFields(
                { name: '⌛ Duração', value: `\`${song.formattedDuration ?? '?:??'}\``, inline: true },
                { name: '🔊 Intensidade', value: `\`${volume}%\``, inline: true },
                { name: '🔁 Encantamento', value: loopLabel, inline: true },
                { name: '📜 Pergaminho', value: `\`${queueSize}\` balada(s)`, inline: true },
                { name: '🛡️ Convocada por', value: requester ? `<@${requester.id}>` : '`Viajante desconhecido`', inline: true },
                {
                    name: '🗺️ Próximas baladas da jornada',
                    value: upcoming.length > 0 ? upcoming.join('\n') : '*O pergaminho não guarda outras canções.*',
                    inline: false,
                },
            )
            .setFooter({ text: 'Taverna de Gideon  •  Use /play para pedir uma canção' });

        if (/^https:\/\//i.test(song.url ?? '')) embed.setURL(song.url);
        if (/^https:\/\//i.test(song.thumbnail ?? '')) embed.setThumbnail(song.thumbnail);
    } else {
        embed
            .setTitle('🏰 O salão aguarda uma canção')
            .setDescription([
                '> *As cordas repousam e a taverna permanece em silêncio...*',
                '',
                'Use `/play` com o nome ou elo de uma canção para despertar o bardo.',
            ].join('\n'))
            .addFields(
                { name: '📜 Exemplo de invocação', value: '`/play The Dragonborn Comes`', inline: false },
                {
                    name: '🗺️ Repertório dos reinos',
                    value: `${PLATFORM_EMOJIS.YouTube} **YouTube**  •  ${PLATFORM_EMOJIS.Spotify} **Spotify**  •  ${PLATFORM_EMOJIS.SoundCloud} **SoundCloud**`,
                    inline: false,
                },
            )
            .setFooter({ text: 'Que rolem os dados e ressoem as canções ⚔️' });
    }

    return embed;
}

function createRows(guildId) {
    const queue = guildQueues.get(guildId);
    const isPaused = queue?.paused ?? false;
    const loopMode = getLoopMode(queue?.loop);
    let loopLabel = 'Sem Refrão';
    if (loopMode === 'song') loopLabel = 'Uma Balada';
    if (loopMode === 'queue') loopLabel = 'Toda a Jornada';
    const loopStyle = loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success;

    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_prev').setEmoji('⏮️').setLabel('Anterior')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('music_pause').setEmoji(isPaused ? '▶️' : '⏸️')
                .setLabel(isPaused ? 'Continuar' : 'Pausar')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setLabel('Pular')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setLabel('Encerrar')
                .setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_loop').setEmoji('🔁').setLabel(loopLabel)
                .setStyle(loopStyle),
            new ButtonBuilder().setCustomId('music_shuffle').setEmoji('🔀').setLabel('Embaralhar')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('music_queue').setEmoji('📜').setLabel('Pergaminho')
                .setStyle(ButtonStyle.Secondary),
        ),
    ];
}

async function updateMessage(guildId) {
    const msg = playerMessages.get(guildId);
    if (!msg) return;
    if (typeof msg.client?.isReady === 'function' && !msg.client.isReady()) {
        clearPlayerMessage(guildId, msg.id);
        return;
    }
    try {
        await msg.edit({ embeds: [createEmbed(guildId)], components: createRows(guildId) });
    } catch (err) {
        if (err.code === 10008) {
            clearPlayerMessage(guildId, msg.id);
            return;
        }
        console.error('Erro ao atualizar embed:', err);
    }
}

// ─── Toca a próxima música da fila ───────────────────────────────
async function playNext(guildId) {
    const queue = guildQueues.get(guildId);
    if (!queue) return;
    if (queue.songs.length === 0) {
        stopProcesses(queue);
        queue.currentResource = null;
        queue.voiceGuard?.syncState();
        await setVoiceChannelStatus(queue.voiceChannel, null);
        await updateMessage(guildId);
        return;
    }

    const song = queue.songs[0];
    queue.paused = false;

    const currentResolution = resolveSongForPlayback(song);
    prefetchNextSong(queue);
    await currentResolution;
    if (guildQueues.get(guildId) !== queue || queue.songs[0] !== song) return;

    const { stream, processes } = createYtStream(song);
    queue.currentProcesses = processes;

    const resource = createAudioResource(stream, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(queue.volume / 100);
    queue.player.play(resource);
    queue.currentResource = resource;

    prefetchNextSong(queue);
    await setVoiceChannelStatus(queue.voiceChannel, createVoiceChannelStatus(song));
    await updateMessage(guildId);
}

async function playNextAvailable(guildId, starter = playNext) {
    const queue = guildQueues.get(guildId);
    if (!queue) return false;

    const maximumAttempts = queue.songs.length;
    const tryNextSong = async (remainingAttempts) => {
        if (queue.songs.length === 0 || remainingAttempts <= 0) return false;
        const song = queue.songs[0];
        try {
            await starter(guildId);
            return true;
        } catch (error) {
            if (guildQueues.get(guildId) !== queue || queue.songs[0] !== song) throw error;
            const title = String(song?.title ?? song?.name ?? 'Faixa desconhecida').slice(0, 120);
            const playbackError = error instanceof Error ? error : new Error(String(error));
            playbackError.platform ??= getSongPlatform(song);
            playbackError.track ??= title;
            console.error(`Erro ao preparar "${title}"; avançando a fila:`, playbackError);
            stopProcesses(queue);
            const failedSong = queue.songs.shift();
            if (failedSong) queue.history.push(failedSong);
            return tryNextSong(remainingAttempts - 1);
        }
    };

    const started = await tryNextSong(maximumAttempts);
    if (!started) await starter(guildId);
    return started;
}

function getSpotifyPlugin() {
    if (!spotifyPlugin) {
        const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
        const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        const spotifyOptions = spotifyClientId && spotifyClientSecret
            ? {
                api: {
                    clientId: spotifyClientId,
                    clientSecret: spotifyClientSecret,
                    topTracksCountry: 'BR',
                },
            }
            : {};

        spotifyPlugin = new SpotifyPlugin(spotifyOptions);
    }
    return spotifyPlugin;
}

function getSpotifyPublicPlugin() {
    if (!spotifyPublicPlugin) spotifyPublicPlugin = new SpotifyPlugin();
    return spotifyPublicPlugin;
}

async function resolveSpotify(query, options, primaryPlugin = getSpotifyPlugin(), publicPluginFactory = getSpotifyPublicPlugin) {
    try {
        return await primaryPlugin.resolve(query, options);
    } catch (error) {
        const isUnavailableEditorialPlaylist = error.errorCode === 'SPOTIFY_API_ERROR'
            && /Resource not found|Status code:\s*404/i.test(error.message);
        if (!isUnavailableEditorialPlaylist) throw error;

        return publicPluginFactory().resolve(query, options);
    }
}

function createSpotifyQueueSongs(resolved, user) {
    const tracks = Array.isArray(resolved.songs) ? resolved.songs : [resolved];
    if (tracks.length > MAX_MUSIC_QUEUE_SIZE) {
        throw new Error(`A playlist possui mais de ${MAX_MUSIC_QUEUE_SIZE} faixas.`);
    }

    return tracks.map((track) => {
        const title = track.name ?? track.title ?? 'Faixa desconhecida';
        const uploader = track.uploader?.name ?? track.uploader ?? 'Artista desconhecido';
        return {
            title,
            duration: track.duration ?? 0,
            formattedDuration: track.formattedDuration ?? formatDuration(track.duration ?? 0),
            thumbnail: track.thumbnail ?? null,
            url: track.url,
            uploader,
            user,
            platform: 'Spotify',
            streamQuery: `${title} ${uploader} official audio`.slice(0, 200),
            streamUrl: null,
            httpHeaders: {},
            resolvedAt: 0,
            preserveMetadata: true,
        };
    });
}

function isMusicActive(guildId) {
    return pendingPlayRequests.has(guildId)
        || guildQueues.has(guildId);
}

function prepareSpotifySourceRecovery(song, error) {
    if (getSongPlatform(song) !== 'Spotify' || !isRecoverableStreamError(error)) return false;
    const attempts = Number(song.streamRecoveryAttempts ?? 0);
    if (attempts >= SPOTIFY_SOURCE_RECOVERY_ATTEMPTS) return false;

    const failedSources = new Set(song.failedStreamSources ?? []);
    const failedSource = getMediaSourceKey(song.streamQuery);
    if (failedSource) failedSources.add(failedSource);
    song.failedStreamSources = [...failedSources];
    song.streamRecoveryAttempts = attempts + 1;
    song.streamUrl = null;
    song.httpHeaders = {};
    song.resolvedAt = 0;
    delete song.streamResolution;
    return true;
}

async function stopCustomQueue(guildId) {
    const queue = guildQueues.get(guildId);
    if (!queue) return;

    queue.transitioning = true;
    queue.voiceGuard?.dispose();
    queue.songs = [];
    guildQueues.delete(guildId);
    const closingMenu = closePlayerMessage(guildId);
    stopProcesses(queue);
    queue.player.stop(true);
    safelyDestroyVoiceConnection(queue.connection);
    await Promise.all([closingMenu, setVoiceChannelStatus(queue.voiceChannel, null)]);
}

async function advanceCustomQueue(guildId, direction = 'next') {
    const queue = guildQueues.get(guildId);
    if (!queue || queue.transitioning) return false;
    if (direction === 'previous' && queue.history.length === 0) return false;

    queue.transitioning = true;
    try {
        stopProcesses(queue);
        if (direction === 'previous') {
            const previous = queue.history.pop();
            queue.songs.unshift(previous);
        } else {
            const current = queue.songs.shift();
            if (current) queue.history.push(current);
        }
        await playNextAvailable(guildId);
        return true;
    } finally {
        const activeQueue = guildQueues.get(guildId);
        if (activeQueue) activeQueue.transitioning = false;
    }
}

// ─── Conecta ao canal de voz e monta o player ────────────────────
async function createQueue(guild, voiceChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    } catch (error) {
        safelyDestroyVoiceConnection(connection);
        if (error?.code === 'ABORT_ERR' || error?.name === 'AbortError') {
            const timeoutError = new Error(
                'O Discord não concluiu a conexão com o canal de voz dentro de 10 segundos.',
                { cause: error },
            );
            timeoutError.code = 'VOICE_CONNECTION_TIMEOUT';
            timeoutError.voiceChannel = voiceChannel.id;
            timeoutError.guild = guild.id;
            throw timeoutError;
        }
        throw error;
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    const queue = {
        songs: [],
        player,
        connection,
        volume: DEFAULT_MUSIC_VOLUME,
        loop: 'off',
        paused: false,
        history: [],
        currentProcesses: null,
        currentResource: null,
        transitioning: false,
        voiceChannel,
    };

    guildQueues.set(guild.id, queue);
    player.on('error', (error) => {
        const activeQueue = guildQueues.get(guild.id);
        if (activeQueue?.currentProcesses) activeQueue.currentProcesses.failed = true;
        handleAudioPlayerError(error);
    });
    queue.voiceGuard = createVoiceSessionGuard({
        client: guild.client,
        connection,
        player,
        voiceChannel,
        onLeave: () => {
            if (guildQueues.get(guild.id) === queue) return stopCustomQueue(guild.id);
            return undefined;
        },
    });

    player.on(AudioPlayerStatus.Idle, () => {
        const handleIdle = async () => {
            const q = guildQueues.get(guild.id);
            if (!q || q.transitioning) return;

            q.transitioning = true;
            try {
                const failedProcesses = q.currentProcesses;
                const playbackFailed = failedProcesses?.failed;
                const failedSong = q.songs[0];
                const shouldRecoverSource = playbackFailed
                    && prepareSpotifySourceRecovery(failedSong, failedProcesses.failure);
                stopProcesses(q);
                if (shouldRecoverSource) {
                    writeErrorLog('RECOVERED_ERROR', [
                        `[Spotify] Fonte recusada; buscando alternativa (${failedSong.streamRecoveryAttempts}/${SPOTIFY_SOURCE_RECOVERY_ATTEMPTS}):`,
                        failedProcesses.failure,
                    ]);
                    await playNextAvailable(guild.id);
                    return;
                }
                if (playbackFailed && failedProcesses.failure && !failedProcesses.failureLogged) {
                    console.error(
                        '[Spotify] Todas as fontes alternativas de áudio falharam:',
                        failedProcesses.failure,
                    );
                }
                if (!playbackFailed && q.loop === 'queue' && q.songs.length > 0) {
                    q.songs.push(q.songs.shift());
                } else if (playbackFailed || q.loop !== 'song') {
                    const finished = q.songs.shift();
                    if (finished) q.history.push(finished);
                }
                await playNextAvailable(guild.id);
            } finally {
                const activeQueue = guildQueues.get(guild.id);
                if (activeQueue) activeQueue.transitioning = false;
            }
        };

        handleIdle().catch((error) => {
            console.error('Erro ao avançar a fila de música:', error);
            const activeQueue = guildQueues.get(guild.id);
            if (activeQueue) activeQueue.transitioning = false;
        });
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        const handleDisconnect = async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch {
                const activeQueue = guildQueues.get(guild.id);
                if (activeQueue?.connection === connection) await stopCustomQueue(guild.id);
                else safelyDestroyVoiceConnection(connection);
            }
        };

        handleDisconnect().catch((error) => {
            console.error('Erro ao tratar desconexão do canal de voz:', error);
        });
    });

    return queue;
}

async function ensureQueue(guild, voiceChannel) {
    if (!voiceChannel.members.some((member) => !member.user.bot)) {
        throw new Error('Não há usuários no canal de voz para iniciar a reprodução.');
    }
    if (guildQueues.has(guild.id)) return guildQueues.get(guild.id);

    const pending = pendingQueueCreations.get(guild.id);
    if (pending) {
        if (pending.voiceChannelId !== voiceChannel.id) {
            throw new Error('Entre no mesmo canal de voz do bot para adicionar músicas.');
        }
        return pending.promise;
    }

    const promise = createQueue(guild, voiceChannel);
    pendingQueueCreations.set(guild.id, { voiceChannelId: voiceChannel.id, promise });
    try {
        return await promise;
    } finally {
        const current = pendingQueueCreations.get(guild.id);
        if (current?.promise === promise) pendingQueueCreations.delete(guild.id);
    }
}

async function enqueueSongs(guild, voiceChannel, songs, helpers = {}) {
    const ensure = helpers.ensureQueue ?? ensureQueue;
    const start = helpers.playNext ?? playNextAvailable;
    const prefetch = helpers.prefetchNextSong ?? prefetchNextSong;
    const refresh = helpers.updateMessage ?? updateMessage;
    const queue = await ensure(guild, voiceChannel);
    queue.songs.push(...songs);

    if (queue.player.state.status === AudioPlayerStatus.Idle && !queue.starting) {
        queue.starting = true;
        try {
            await start(guild.id);
        } finally {
            queue.starting = false;
        }
    } else {
        prefetch(queue);
        await refresh(guild.id);
    }
    return queue;
}

// ─── Exports ─────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Toca uma música ou playlist (YouTube, Spotify, SoundCloud, etc)')
        .addStringOption((option) => option.setName('query')
            .setDescription('Nome da música, link do YouTube, Spotify, SoundCloud...')
            .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        const { guildId } = interaction;
        beginPlayRequest(guildId);

        try {
            await interaction.deferReply({ flags: 64 });

            if (activePlayers.has(guildId)) {
                return interaction.editReply(
                    '⚠️ O painel de áudios está ativo. Encerre-o antes de usar `/play`.',
                );
            }

            const voiceChannel = interaction.member.voice.channel;
            if (!voiceChannel) return interaction.editReply('❌ Você precisa estar em um canal de voz!');
            const botPermissions = voiceChannel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions?.has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
                return interaction.editReply('❌ Preciso das permissões Conectar e Falar nesse canal.');
            }

            const query = validateQuery(interaction.options.getString('query'));
            const platform = detectMusicPlatform(query);
            const customQueue = guildQueues.get(interaction.guild.id);
            const activeVoiceChannelId = customQueue?.connection?.joinConfig?.channelId;
            if (activeVoiceChannelId && activeVoiceChannelId !== voiceChannel.id) {
                return interaction.editReply('❌ Entre no mesmo canal de voz do bot para adicionar músicas.');
            }

            let songs;
            if (platform === 'Spotify') {
                const resolved = await resolveSpotify(query, { member: interaction.member });
                songs = createSpotifyQueueSongs(resolved, interaction.user);
            } else if (platform === 'SoundCloud') {
                songs = await getSoundCloudSongs(query, interaction.user);
            } else if (isPlaylistUrl(query)) {
                songs = await getPlaylistSongs(query, interaction.user);
            } else {
                const songInfo = await getSongInfo(query, { useCookies: true });
                songInfo.user = interaction.user;
                songs = [songInfo];
            }

            if (!playerMessages.has(interaction.guild.id)) {
                const sentMessage = await interaction.channel.send({
                    embeds: [createEmbed(interaction.guild.id)],
                    components: createRows(interaction.guild.id),
                });
                registerPlayerMessage(interaction.guild.id, sentMessage, interaction.client);
            }

            await enqueueSongs(interaction.guild, voiceChannel, songs);
            await dismissReply(interaction);
        } catch (error) {
            const ageRestricted = error?.code === 'YOUTUBE_AGE_AUTH_REQUIRED';
            const unavailable = error?.code === 'YOUTUBE_UNAVAILABLE';
            if (ageRestricted || unavailable) console.error('[YouTube]', error);
            else console.error(error);

            let response = '❌ Não foi possível carregar essa música. Confira a busca ou o link.';
            if (ageRestricted) {
                response = '❌ Este vídeo possui restrição de idade. Atualize os cookies com uma conta apta a assisti-lo.';
            } else if (unavailable) {
                response = '❌ Esse vídeo do YouTube está indisponível ou foi removido.';
            }
            if (interaction.deferred || interaction.replied) await interaction.editReply(response);
            else await interaction.reply({ content: response, flags: 64 });
        } finally {
            endPlayRequest(guildId);
        }
    },

    // Exporta para o interaction handler
    guildQueues,
    playerMessages,
    clearPlayerMessage,
    closePlayerMessage,
    registerPlayerMessage,
    createEmbed,
    createRows,
    updateMessage,
    playNext,
    playNextAvailable,
    enqueueSongs,
    advanceCustomQueue,
    isMusicActive,
    stopCustomQueue,
    formatDuration,
    validateQuery,
    getFirstMediaEntry,
    getSelectedStreamData,
    normalizeMatchText,
    scoreYouTubeCandidate,
    getYouTubeCandidateUrl,
    getMediaSourceKey,
    isRecoverableStreamError,
    buildFfmpegHeaders,
    isDecodedAudioComplete,
    createYtDlpError,
    parseYtDlpJson,
    searchYouTubeCandidates,
    resolveSpotifyPlayback,
    createYtStream,
    handleAudioPlayerError,
    createVoiceChannelStatus,
    setVoiceChannelStatus,
    createSpotifyQueueSongs,
    prepareSpotifySourceRecovery,
    createSoundCloudQueueSongs,
    getSoundCloudSongs,
    resolveSoundCloudUrl,
    createPlaylistQueueSongs,
    getPlaylistSongs,
    isPlaylistUrl,
    getSongPlatform,
    detectMusicPlatform,
    getPlatformIcon,
    PLATFORM_EMOJIS,
    isSongStreamFresh,
    resolveSongStream,
    resolveSongForPlayback,
    prefetchNextSong,
    resolveSpotify,
};
