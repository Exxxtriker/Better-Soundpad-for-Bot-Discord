const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, Image } = require('canvas');

const DISPLAY_WIDTH = 640;
const JPEG_QUALITY = 0.8;
const attachmentCache = new Map();

function createCacheKey(sourcePath) {
    const stats = fs.statSync(sourcePath);
    return `${sourcePath}:${stats.size}:${stats.mtimeMs}`;
}

function createDisplayBuffer(sourcePath) {
    const image = new Image();
    image.src = fs.readFileSync(sourcePath);
    const scale = Math.min(1, DISPLAY_WIDTH / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    return canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
}

function getDisplayAttachment(sourcePath, requestedName = null) {
    const cacheKey = createCacheKey(sourcePath);
    let buffer = attachmentCache.get(cacheKey);
    if (!buffer) {
        buffer = createDisplayBuffer(sourcePath);
        attachmentCache.set(cacheKey, buffer);
    }

    const parsed = path.parse(requestedName || path.basename(sourcePath));
    const name = `${parsed.name}.jpg`;
    return {
        attachment: buffer,
        name,
        sourceAttachment: sourcePath,
        url: `attachment://${name}`,
    };
}

function clearImageAttachmentCache() {
    attachmentCache.clear();
}

module.exports = {
    DISPLAY_WIDTH,
    JPEG_QUALITY,
    clearImageAttachmentCache,
    getDisplayAttachment,
};
