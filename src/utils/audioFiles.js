const path = require('node:path');

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DOWNLOADED_AUDIO_BYTES = 250 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 2 * 60 * 60;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);

function sanitizeBaseName(value) {
    const withoutControls = Array.from(value, (character) => (
        character.codePointAt(0) < 32 ? '_' : character
    )).join('');
    const normalized = withoutControls
        .normalize('NFKC')
        .trim()
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .slice(0, 80);

    if (!normalized || normalized === '.' || normalized === '..') {
        throw new Error('Nome de arquivo inválido.');
    }

    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
        return `_${normalized}`;
    }

    return normalized;
}

function resolveInside(directory, fileName) {
    const root = path.resolve(directory);
    const resolved = path.resolve(root, fileName);

    if (path.dirname(resolved) !== root) {
        throw new Error('Caminho de arquivo inválido.');
    }

    return resolved;
}

function validateYouTubeUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Informe uma URL válida do YouTube.');
    }

    const allowedHosts = new Set([
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtu.be',
    ]);

    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) {
        throw new Error('Apenas URLs HTTPS do YouTube são permitidas.');
    }

    return url.toString();
}

module.exports = {
    MAX_AUDIO_BYTES,
    MAX_AUDIO_DURATION_SECONDS,
    MAX_DOWNLOADED_AUDIO_BYTES,
    SUPPORTED_AUDIO_EXTENSIONS,
    resolveInside,
    sanitizeBaseName,
    validateYouTubeUrl,
};
