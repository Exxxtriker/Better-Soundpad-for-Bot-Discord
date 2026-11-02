/* eslint-disable max-classes-per-file, no-underscore-dangle */
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const ffmpegPath = require('ffmpeg-static');

const SAMPLE_RATE = 48_000;
const FRAME_MS = 20;
const FRAME_BYTES = ((SAMPLE_RATE * 2 * 2) * FRAME_MS) / 1_000;
const MAX_BUFFERED_BYTES = FRAME_BYTES * 100;
const RESUME_BUFFERED_BYTES = FRAME_BYTES * 25;
const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES);

function mixPcmFrames(background, effect, backgroundVolume, effectVolume) {
    const result = Buffer.allocUnsafe(FRAME_BYTES);
    for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
        const sample = Math.round(
            background.readInt16LE(offset) * backgroundVolume
            + effect.readInt16LE(offset) * effectVolume,
        );
        result.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset);
    }
    return result;
}

class PcmLayer {
    constructor(filePath, onError, onData) {
        this.chunks = [];
        this.chunkOffset = 0;
        this.bufferedBytes = 0;
        this.ended = false;
        this.stopped = false;
        this.errorReported = false;
        this.stderr = '';
        const reportError = (error) => {
            if (this.stopped || this.errorReported) return;
            this.errorReported = true;
            onError(error);
        };
        this.process = spawn(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-i', filePath, '-vn', '-ac', '2', '-ar', String(SAMPLE_RATE),
            '-f', 's16le', 'pipe:1',
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

        this.process.stdout.on('data', (chunk) => {
            if (this.stopped) return;
            this.chunks.push(chunk);
            this.bufferedBytes += chunk.length;
            if (this.bufferedBytes >= MAX_BUFFERED_BYTES) this.process.stdout.pause();
            onData();
        });
        this.process.stdout.on('end', () => {
            // Só o fechamento do processo confirma se o EOF foi sucesso ou falha.
            onData();
        });
        this.process.stdout.on('error', (error) => {
            this.ended = true;
            reportError(error);
            onData();
        });
        this.process.stderr.on('data', (chunk) => {
            this.stderr = `${this.stderr}${chunk.toString()}`.slice(-2_000);
        });
        this.process.on('error', (error) => {
            this.ended = true;
            reportError(error);
            onData();
        });
        this.process.on('close', (code) => {
            this.ended = true;
            if (!this.stopped && code !== 0) {
                reportError(new Error(this.stderr.trim() || `FFmpeg encerrou com código ${code}.`));
            }
            onData();
        });
    }

    get hasFrame() {
        return this.bufferedBytes >= FRAME_BYTES || (this.ended && this.bufferedBytes > 0);
    }

    readFrame() {
        const frame = Buffer.alloc(FRAME_BYTES);
        let written = 0;
        while (written < FRAME_BYTES && this.chunks.length > 0) {
            const chunk = this.chunks[0];
            const length = Math.min(FRAME_BYTES - written, chunk.length - this.chunkOffset);
            chunk.copy(frame, written, this.chunkOffset, this.chunkOffset + length);
            written += length;
            this.chunkOffset += length;
            this.bufferedBytes -= length;
            if (this.chunkOffset === chunk.length) {
                this.chunks.shift();
                this.chunkOffset = 0;
            }
        }
        if (this.bufferedBytes <= RESUME_BUFFERED_BYTES) this.process.stdout.resume();
        return frame;
    }

    get drained() {
        return this.ended && this.bufferedBytes === 0;
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.ended = true;
        this.chunks = [];
        this.bufferedBytes = 0;
        this.process.stdout.destroy();
        this.process.kill();
    }
}

class SoundpadMixer extends Readable {
    constructor({ onLayerEnd, onEmpty, onError } = {}) {
        super({ highWaterMark: FRAME_BYTES * 8 });
        this.layers = { background: null, effect: null };
        this.volumes = { background: 0.7, effect: 1 };
        this.onLayerEnd = onLayerEnd;
        this.onEmpty = onEmpty;
        this.onError = onError;
        this.canPush = true;
        this.pumping = false;
        this.paused = false;
        this.finished = false;
        this.started = false;
    }

    _read() {
        this.canPush = true;
        this.pump();
    }

    _destroy(error, callback) {
        this.finished = true;
        Object.values(this.layers).forEach((layer) => layer?.stop());
        this.layers.background = null;
        this.layers.effect = null;
        callback(error);
    }

    setLayer(kind, filePath) {
        if (this.finished) throw new Error('O mixer do soundpad foi encerrado.');
        if (!Object.hasOwn(this.layers, kind)) throw new Error('Camada de áudio inválida.');
        this.started = true;
        this.layers[kind]?.stop();
        this.layers[kind] = null;
        try {
            this.layers[kind] = new PcmLayer(filePath, (error) => this.onError?.(kind, error), () => this.pump());
        } catch (error) {
            this.onError?.(kind, error);
            this.finishIfEmpty();
            throw error;
        }
        this.pump();
    }

    removeLayer(kind) {
        if (this.finished || !Object.hasOwn(this.layers, kind)) return;
        this.layers[kind]?.stop();
        this.layers[kind] = null;
        this.pump();
    }

    setPaused(paused) {
        this.paused = paused;
        if (!paused) this.pump();
    }

    finishIfEmpty() {
        if (this.finished || !this.started || this.layers.background || this.layers.effect) return;
        this.finished = true;
        this.push(null);
        this.onEmpty?.();
    }

    finishDrainedLayers() {
        ['background', 'effect'].forEach((kind) => {
            if (!this.layers[kind]?.drained) return;
            this.layers[kind].stop();
            this.layers[kind] = null;
            this.onLayerEnd?.(kind);
        });
        this.finishIfEmpty();
    }

    pump() {
        if (this.finished || this.paused || !this.canPush || this.pumping) return;
        this.pumping = true;
        try {
            while (!this.finished && !this.paused && this.canPush) {
                this.finishDrainedLayers();
                if (this.finished) break;
                const { background, effect } = this.layers;
                if (!background && !effect) break;
                if (background && !background.hasFrame) break;
                if (!background && effect && !effect.hasFrame) break;
                const backgroundFrame = background?.readFrame() || SILENCE_FRAME;
                const effectFrame = effect?.hasFrame ? effect.readFrame() : SILENCE_FRAME;
                this.canPush = this.push(mixPcmFrames(
                    backgroundFrame,
                    effectFrame,
                    this.volumes.background,
                    this.volumes.effect,
                ));
            }
        } finally {
            this.pumping = false;
        }
    }
}

module.exports = {
    FRAME_BYTES,
    PcmLayer,
    SoundpadMixer,
    mixPcmFrames,
};
