/* eslint-disable no-await-in-loop -- as novas tentativas precisam ser sequenciais. */
const axios = require('axios');

function spotifyError(code, message, cause) {
    return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function parseSpotifyReference(query) {
    const url = new URL(query);
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{22})\/?$/i);
    if (url.protocol !== 'https:' || !['open.spotify.com', 'spotify.com'].includes(url.hostname) || !match) {
        throw spotifyError('SPOTIFY_INVALID_URL', 'Use um link válido de música, álbum, playlist ou artista do Spotify.');
    }
    const [, rawType, id] = match;
    const type = rawType.toLowerCase();
    return { type, id, url: `https://open.spotify.com/${type}/${id}` };
}

function isSpotifyMetadataParseError(error) {
    return typeof error?.html === 'string'
        || /couldn.t find (?:any data|scripts)|spotify-url-info|embed page.*parse/i
            .test([error?.message, error?.stack].filter(Boolean).join('\n'));
}

function getThumbnail(entity) {
    const images = entity.coverArt?.sources ?? entity.visualIdentity?.image ?? entity.images ?? [];
    return images.find((image) => /^https:\/\//i.test(image?.url ?? ''))?.url ?? null;
}

function createSpotifyTrack(track, thumbnail) {
    const match = String(track.uri ?? '').match(/spotify:track:([A-Za-z0-9]{22})$/);
    const id = match?.[1] ?? track.id;
    const name = track.name ?? track.title;
    if (!/^[A-Za-z0-9]{22}$/.test(id ?? '') || typeof name !== 'string' || !name.trim()) return null;
    const artistNames = Array.isArray(track.artists)
        ? track.artists.map((artist) => artist?.name).filter(Boolean).join(', ')
        : '';
    const durationMs = Number(track.duration ?? track.duration_ms);
    return {
        name,
        url: `https://open.spotify.com/track/${id}`,
        uploader: { name: artistNames || track.subtitle || 'Artista desconhecido' },
        duration: Number.isFinite(durationMs) ? Math.max(0, durationMs / 1000) : 0,
        thumbnail: getThumbnail(track) ?? thumbnail,
    };
}

function resolveSpotifyEntity(entity, reference) {
    if (!entity || typeof entity !== 'object') return null;
    const uri = String(entity.uri ?? '');
    const uriMatch = uri.match(/spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/);
    if ((uriMatch?.[1] ?? entity.type) !== reference.type
        || (uriMatch?.[2] ?? entity.id) !== reference.id) return null;
    const thumbnail = getThumbnail(entity);
    if (reference.type === 'track') return createSpotifyTrack(entity, thumbnail);
    if (!Array.isArray(entity.trackList)) return null;
    const songs = entity.trackList.map((track) => createSpotifyTrack(track, thumbnail)).filter(Boolean);
    if (songs.length === 0) return null;
    return {
        name: entity.name ?? entity.title, url: reference.url, thumbnail, songs,
    };
}

function parseSpotifyEmbed(html, query) {
    const reference = parseSpotifyReference(query);
    // O script pode estar no head ou aninhado, não apenas como filho direto do body.
    const scripts = String(html ?? '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
    for (const [, attributes, content] of scripts) {
        const id = attributes.match(/\bid\s*=\s*["'](__NEXT_DATA__|initial-state|resource)["']/i)?.[1];
        if (!id) continue; // eslint-disable-line no-continue
        try {
            const json = JSON.parse(id === '__NEXT_DATA__' ? content : Buffer.from(content, 'base64').toString('utf8'));
            let entity;
            if (id === '__NEXT_DATA__') {
                const page = json.props?.pageProps;
                entity = page?.state?.data?.entity ?? page?.state?.entity ?? page?.data?.entity;
            } else {
                entity = id === 'resource' ? json : json.data?.entity;
            }
            const resolved = resolveSpotifyEntity(entity, reference);
            if (resolved) return resolved;
        } catch {
            // Tenta outro script JSON conhecido, sem executar código da página.
        }
    }
    throw spotifyError('SPOTIFY_METADATA_UNAVAILABLE', 'O Spotify não retornou dados públicos válidos para este link. Tente novamente em instantes.');
}

async function readSpotifyPublicMetadata(query, helpers = {}) {
    const reference = parseSpotifyReference(query);
    const request = helpers.request ?? axios.get;
    const wait = helpers.wait ?? ((delay) => new Promise((resolve) => { setTimeout(resolve, delay); }));
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await request(`https://open.spotify.com/embed/${reference.type}/${reference.id}`, {
                timeout: 12_000,
                maxContentLength: 2 * 1024 * 1024,
                headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
            });
            return parseSpotifyEmbed(response.data, reference.url);
        } catch (error) {
            lastError = error;
            const status = Number(error.response?.status);
            if ([401, 403, 404].includes(status)) {
                throw spotifyError(
                    'SPOTIFY_METADATA_UNAVAILABLE',
                    'O Spotify recusou a leitura deste link. Confira se ele está público e disponível.',
                    error,
                );
            }
            if (attempt === 0) await wait(500); // eslint-disable-line no-await-in-loop
        }
    }
    throw spotifyError(
        'SPOTIFY_METADATA_UNAVAILABLE',
        'Não consegui ler os dados públicos do Spotify após duas tentativas. Tente novamente em instantes.',
        lastError,
    );
}

module.exports = {
    isSpotifyMetadataParseError,
    parseSpotifyReference,
    parseSpotifyEmbed,
    readSpotifyPublicMetadata,
};
