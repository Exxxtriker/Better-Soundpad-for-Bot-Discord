/* eslint-disable max-len */
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType,
} = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');
const { safelyDestroyVoiceConnection } = require('../utils/voiceConnection');
const { createVoiceSessionGuard } = require('../utils/voiceSessionGuard');
const { buildAudioCatalog, parseAudioName } = require('../utils/audioCatalog');
const { loadAudioMetadata } = require('../utils/audioMetadata');
const { SoundpadMixer } = require('../utils/soundpadMixer');

const BACKGROUND_CATEGORIES = new Set(['Trilhas Sonoras', 'Ambientes', 'Músicas']);

class AudioPlayerManager {
    constructor(guild, voiceChannel, audioFolder, supportedExtensions, client, onDestroy) {
        this.guild = guild;
        this.voiceChannel = voiceChannel;
        this.audioFolder = audioFolder;
        this.supportedExtensions = supportedExtensions;
        this.client = client; // Discord client para ouvir voiceStateUpdate
        this.onDestroy = onDestroy;
        this.destroyed = false;
        this.controlQueue = Promise.resolve();

        this.currentResource = null;
        this.mixer = null;
        this.backgroundAudioName = null;
        this.effectAudioName = null;
        this.volumes = { background: 0.7, effect: 1.0 };
        this.playbackLayer = 'background';
        this.layerOverridden = false;
        this.loopEnabled = false;

        this.updateMessage = null; // função para atualizar embed e componentes
        this.sentMessage = null; // mensagem enviada para editar

        this.currentPage = 1; // paginação
        this.itemsPerPage = 25; // áudios por página

        // Lista de áudios
        this.reloadAudioList();

        // Só cria a sessão de voz depois que o catálogo foi carregado com sucesso.
        this.player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
        });
        try {
            this.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });
            this.connection.subscribe(this.player);
        } catch (error) {
            safelyDestroyVoiceConnection(this.connection);
            throw error;
        }

        // Listener do player
        this.player.on(AudioPlayerStatus.Idle, () => {
            if (this.destroyed) return;
            if (this.mixer && !this.mixer.finished) return;
            this.currentResource = null;
            this.mixer = null;
            this.requestMessageUpdate();
            this.startIdleTimeout();
        });

        this.player.on('error', (error) => {
            console.error('Erro no player:', error);
            this.mixer?.destroy();
            this.mixer = null;
            this.currentResource = null;
            this.backgroundAudioName = null;
            this.effectAudioName = null;
            this.requestMessageUpdate();
            this.startIdleTimeout();
        });

        this.voiceGuard = createVoiceSessionGuard({
            client,
            voiceChannel,
            connection: this.connection,
            player: this.player,
            onLeave: () => this.destroy({ deleteMessage: true }),
        });
    }

    // ----------------- Paginação e Reload -----------------
    getTotalPages() {
        return Math.ceil(this.getSelectedEntries().length / this.itemsPerPage) || 1;
    }

    getAudioPage() {
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return this.getSelectedEntries().slice(start, end);
    }

    getCategories() {
        return [...this.audioCatalog.keys()];
    }

    getSelectedEntries() {
        return this.audioCatalog.get(this.selectedCategory) || [];
    }

    getAudioCount() {
        return this.audioNames.length;
    }

    getPlaybackStatusLabel() {
        const labels = {
            [AudioPlayerStatus.Playing]: 'Tocando',
            [AudioPlayerStatus.Paused]: 'Pausado',
            [AudioPlayerStatus.AutoPaused]: 'Pausado automaticamente',
            [AudioPlayerStatus.Buffering]: 'Preparando o áudio',
            [AudioPlayerStatus.Idle]: 'Aguardando uma escolha',
        };
        return labels[this.player?.state?.status] || 'Aguardando uma escolha';
    }

    selectCategory(category) {
        if (!this.audioCatalog.has(category)) return false;
        this.selectedCategory = category;
        this.currentPage = 1;
        this.playbackLayer = BACKGROUND_CATEGORIES.has(category) ? 'background' : 'effect';
        this.layerOverridden = false;
        return true;
    }

    togglePlaybackLayer() {
        this.playbackLayer = this.playbackLayer === 'background' ? 'effect' : 'background';
        this.layerOverridden = true;
        return this.playbackLayer;
    }

    getDisplayName(audioName) {
        const entry = [...this.audioCatalog.values()]
            .flat()
            .find((audio) => audio.audioName === audioName);
        return entry?.displayName || parseAudioName(audioName).displayName;
    }

    getAudioMetadata(audioName) {
        if (!audioName) return null;
        return this.audioMetadata[audioName] || null;
    }

    reloadAudioList() {
        const previousAudioNames = new Set(this.audioNames || []);
        const previousCategory = this.selectedCategory;
        const previousPage = this.currentPage || 1;
        const files = fs.readdirSync(this.audioFolder, { withFileTypes: true })
            .filter((entry) => entry.isFile()
                && this.supportedExtensions.includes(path.extname(entry.name).toLowerCase()))
            .map((entry) => entry.name);
        this.audioNames = [...new Set(files.map((file) => path.basename(file, path.extname(file))))];
        this.audioCatalog = buildAudioCatalog(this.audioNames);
        this.audioMetadata = loadAudioMetadata(this.audioFolder);
        const categoryPreserved = this.audioCatalog.has(previousCategory);
        this.selectedCategory = categoryPreserved ? previousCategory : this.getCategories()[0];
        if (!this.layerOverridden) {
            this.playbackLayer = BACKGROUND_CATEGORIES.has(this.selectedCategory) ? 'background' : 'effect';
        }
        this.currentPage = categoryPreserved
            ? Math.min(Math.max(previousPage, 1), this.getTotalPages())
            : 1;
        this.lastReloadAt = Date.now();

        const currentAudioNames = new Set(this.audioNames);
        return {
            added: this.audioNames.filter((audioName) => !previousAudioNames.has(audioName)),
            removed: [...previousAudioNames].filter((audioName) => !currentAudioNames.has(audioName)),
            audioCount: this.getAudioCount(),
            categoryCount: this.getCategories().length,
        };
    }
    // -------------------------------------------------------

    setUpdateMessageFunction(fn) {
        this.updateMessage = fn;
    }

    enqueueControl(callback) {
        const operation = this.controlQueue.then(() => {
            if (this.destroyed) return false;
            return callback();
        });
        this.controlQueue = operation.catch(() => {});
        return operation;
    }

    requestMessageUpdate() {
        if (this.destroyed || typeof this.updateMessage !== 'function') return;
        Promise.resolve(this.updateMessage()).catch((error) => {
            if (error.code !== 10008) console.error('Erro ao atualizar painel do soundpad:', error);
        });
    }

    setSentMessage(message) {
        if (this.destroyed) {
            message.delete().catch((error) => {
                if (error.code !== 10008) console.error('Erro ao remover o menu de áudio:', error);
            });
            return;
        }
        this.sentMessage = message;
    }

    playAudio(audioName, layer = this.playbackLayer) {
        if (this.destroyed || !this.audioNames.includes(audioName)) return false;
        const audioPath = this.supportedExtensions
            .map((ext) => path.join(this.audioFolder, audioName + ext))
            .find((p) => fs.existsSync(p));
        if (!audioPath) return false;

        this.playResource(audioPath, audioName, layer);
        return true;
    }

    createMixer() {
        const mixer = new SoundpadMixer({
            onLayerEnd: (layer) => {
                if (this.destroyed || this.mixer !== mixer) return;
                const name = layer === 'background' ? this.backgroundAudioName : this.effectAudioName;
                if (layer === 'background' && this.loopEnabled && name && this.audioNames.includes(name)) {
                    const audioPath = this.getAudioPath(name);
                    if (audioPath) {
                        try {
                            mixer.setLayer('background', audioPath);
                            return;
                        } catch (error) {
                            this.loopEnabled = false;
                            console.error('Erro ao reiniciar trilha do soundpad:', error);
                        }
                    }
                }
                if (layer === 'background') this.backgroundAudioName = null;
                else this.effectAudioName = null;
                this.requestMessageUpdate();
            },
            onError: (layer, error) => {
                if (layer === 'background') this.loopEnabled = false;
                console.error(`Erro na camada ${layer} do soundpad:`, error);
            },
        });
        mixer.volumes = { ...this.volumes };
        mixer.on('error', (error) => console.error('Erro no mixer do soundpad:', error));
        this.mixer = mixer;
        this.currentResource = createAudioResource(mixer, { inputType: StreamType.Raw });
        return mixer;
    }

    getAudioPath(audioName) {
        return this.supportedExtensions
            .map((ext) => path.join(this.audioFolder, audioName + ext))
            .find((filePath) => fs.existsSync(filePath));
    }

    playResource(audioPath, audioName, layer = this.playbackLayer) {
        if (this.destroyed) return;
        const firstLayer = !this.mixer || this.mixer.finished;
        const mixer = firstLayer ? this.createMixer() : this.mixer;
        try {
            mixer.setLayer(layer, audioPath);
        } catch (error) {
            if (firstLayer) {
                mixer.destroy();
                this.mixer = null;
                this.currentResource = null;
            }
            throw error;
        }
        if (layer === 'background') this.backgroundAudioName = audioName;
        else this.effectAudioName = audioName;
        if (firstLayer) this.player.play(this.currentResource);
        else if (this.player.state.status === AudioPlayerStatus.Paused) this.unpause();
    }

    pause() {
        if (this.destroyed) return false;
        this.mixer?.setPaused(true);
        return this.player.pause();
    }

    unpause() {
        if (this.destroyed) return false;
        this.mixer?.setPaused(false);
        return this.player.unpause();
    }

    stopLayer(layer) {
        if (this.destroyed || !this.mixer) return false;
        this.mixer.removeLayer(layer);
        if (layer === 'background') this.backgroundAudioName = null;
        else this.effectAudioName = null;
        this.startIdleTimeout();
        return true;
    }

    stop() {
        if (this.destroyed) return false;
        this.mixer?.destroy();
        this.mixer = null;
        this.currentResource = null;
        this.backgroundAudioName = null;
        this.effectAudioName = null;
        const stopped = this.player.stop(true);
        this.startIdleTimeout();
        return stopped;
    }

    setVolume(layer, volume) {
        if (this.destroyed) return this.volumes[layer];
        this.volumes[layer] = Math.min(2, Math.max(0, volume));
        if (this.mixer) this.mixer.volumes[layer] = this.volumes[layer];
        return this.volumes[layer];
    }

    toggleLoop() {
        if (this.destroyed) return false;
        this.loopEnabled = !this.loopEnabled;
        return this.loopEnabled;
    }

    destroy({ deleteMessage = false } = {}) {
        if (this.destroyed) return;
        this.destroyed = true;
        this.loopEnabled = false;
        this.voiceGuard?.dispose();
        this.mixer?.destroy();
        this.mixer = null;
        this.player.stop(true);
        this.currentResource = null;
        this.backgroundAudioName = null;
        this.effectAudioName = null;
        safelyDestroyVoiceConnection(this.connection);
        if (deleteMessage && this.sentMessage && !this.sentMessage.deleted) {
            this.sentMessage.delete().catch((error) => {
                if (error.code !== 10008) console.error('Erro ao apagar painel do soundpad:', error);
            });
        }
        this.updateMessage = null;
        this.onDestroy?.();
        this.onDestroy = null;
    }

    startIdleTimeout() {
        this.voiceGuard?.syncState();
    }

    clearIdleTimeout() {
        this.voiceGuard?.clearIdleTimeout();
    }
}

module.exports = AudioPlayerManager;
