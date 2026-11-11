const fs = require('node:fs');
const path = require('node:path');

const METADATA_FILE_NAME = '.audio-metadata.json';

function getMetadataPath(audioFolder) {
    return path.join(audioFolder, METADATA_FILE_NAME);
}

function loadAudioMetadata(audioFolder) {
    const metadataPath = getMetadataPath(audioFolder);
    if (!fs.existsSync(metadataPath)) return {};

    try {
        const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        console.error('Erro ao ler metadados do soundpad:', error);
        return {};
    }
}

function saveAudioMetadata(audioFolder, audioName, metadata) {
    const catalog = loadAudioMetadata(audioFolder);
    catalog[audioName] = {
        source: String(metadata.source || 'unknown').slice(0, 30),
        sourceChannel: String(metadata.sourceChannel || '').trim().slice(0, 100),
        savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(getMetadataPath(audioFolder), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    return catalog[audioName];
}

function getAudioMetadata(audioFolder, audioName) {
    return loadAudioMetadata(audioFolder)[audioName] || null;
}

module.exports = {
    METADATA_FILE_NAME,
    getAudioMetadata,
    loadAudioMetadata,
    saveAudioMetadata,
};
