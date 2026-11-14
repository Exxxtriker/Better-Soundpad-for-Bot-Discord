function timestampError(message) {
    return Object.assign(new Error(message), { code: 'MUSIC_INVALID_START_TIME' });
}

const YOUTUBE_HOSTS = Object.freeze([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

function getStartTimeValue(url) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    return url.searchParams.get('t') ?? url.searchParams.get('start')
        ?? url.searchParams.get('time_continue') ?? fragment.get('t') ?? fragment.get('start');
}

function getYouTubeVideoId(query) {
    let url;
    try {
        url = new URL(query);
    } catch {
        return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (!YOUTUBE_HOSTS.includes(hostname)) return null;
    return url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1] ?? null;
}

function getYouTubeStartTime(query) {
    let url;
    try {
        url = new URL(query);
    } catch {
        return 0;
    }
    if (!YOUTUBE_HOSTS.includes(url.hostname.toLowerCase())) return 0;
    const raw = getStartTimeValue(url);
    if (raw === null) return 0;
    const value = raw.trim().toLowerCase();
    let seconds;
    if (/^\d+(?:\.\d+)?$/.test(value)) seconds = Number(value);
    else {
        const units = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
        const clock = value.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
        if (units && value) seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
        else if (clock) seconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    }
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2_147_483_647) {
        throw timestampError('O tempo inicial do link é inválido. Use segundos ou um formato como 1m30s.');
    }
    return seconds;
}

function validateSongStartTime(song) {
    const startTime = Number(song.startTime ?? 0);
    if (!Number.isFinite(startTime) || startTime < 0 || startTime > 2_147_483_647) {
        throw timestampError('O tempo inicial do link é inválido.');
    }
    const duration = Number(song.duration);
    if (startTime > 0 && Number.isFinite(duration) && duration > 0 && startTime >= duration) {
        throw timestampError('O tempo inicial do link precisa ser menor que a duração do vídeo.');
    }
    return startTime;
}

function parseYouTubeRequest(query) {
    let parsed;
    try {
        parsed = new URL(query);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:' || !YOUTUBE_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
    const videoId = getYouTubeVideoId(query);
    const playlistId = parsed.searchParams.get('list');
    if (playlistId !== null && !/^[A-Za-z0-9_-]{2,128}$/.test(playlistId)) {
        throw new Error('O identificador da playlist do YouTube é inválido.');
    }
    const explicitPlaylist = parsed.pathname.replace(/\/$/, '') === '/playlist';
    // Tempo explícito (inclusive t=0) em um vídeo tem prioridade sobre list.
    if (videoId && !explicitPlaylist && (getStartTimeValue(parsed) !== null || !playlistId)) {
        const startTime = getYouTubeStartTime(query);
        const timeSuffix = startTime > 0 ? `&t=${startTime}` : '';
        return {
            type: 'video',
            videoId,
            startTime,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${timeSuffix}`,
        };
    }
    if (playlistId) {
        const type = /^RD/.test(playlistId) ? 'mix' : 'playlist';
        const url = type === 'mix' && videoId
            ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(playlistId)}`
            : `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
        return {
            type, videoId, playlistId, startTime: 0, url,
        };
    }
    return null;
}

module.exports = {
    YOUTUBE_HOSTS, getYouTubeVideoId, getYouTubeStartTime, validateSongStartTime, parseYouTubeRequest,
};
