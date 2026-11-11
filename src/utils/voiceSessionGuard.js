/* eslint no-use-before-define: ["error", { "functions": false }] */
const { AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');

const VOICE_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

function createVoiceSessionGuard({
    client, connection, player, voiceChannel, onLeave,
    timers = { setTimeout, clearTimeout },
}) {
    let channel = voiceChannel;
    let timeout = null;
    let disposed = false;

    function clearIdleTimeout() {
        if (timeout !== null) timers.clearTimeout(timeout);
        timeout = null;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        clearIdleTimeout();
        client.removeListener('voiceStateUpdate', onVoiceState);
        player.removeListener('stateChange', syncState);
        connection.removeListener(VoiceConnectionStatus.Destroyed, onDestroyed);
    }

    function leave(reason) {
        if (disposed) return;
        dispose();
        Promise.resolve().then(() => onLeave(reason)).catch((error) => {
            console.error('Erro ao encerrar sessão de voz:', error);
        });
    }

    function syncState() {
        if (disposed) return;
        if (player.state.status === AudioPlayerStatus.Playing) {
            clearIdleTimeout();
        } else if (timeout === null) {
            timeout = timers.setTimeout(() => {
                timeout = null;
                if (player.state.status !== AudioPlayerStatus.Playing) leave('idle');
            }, VOICE_IDLE_TIMEOUT_MS);
            timeout.unref?.();
        }
    }

    function checkChannel() {
        if (channel?.members && !channel.members.some((member) => !member.user.bot)) leave('empty');
    }

    function onVoiceState(oldState, newState) {
        if (newState.guild.id !== voiceChannel.guild.id) return;
        if (newState.id === client.user.id) {
            if (!newState.channelId) {
                leave('disconnected');
                return;
            }
            channel = newState.channel;
        }
        if (oldState.channelId === channel?.id || newState.channelId === channel?.id) checkChannel();
    }

    function onDestroyed() {
        leave('disconnected');
    }

    client.on('voiceStateUpdate', onVoiceState);
    player.on('stateChange', syncState);
    connection.on(VoiceConnectionStatus.Destroyed, onDestroyed);
    syncState();
    queueMicrotask(checkChannel);

    return {
        dispose,
        syncState,
        clearIdleTimeout,
        get disposed() { return disposed; },
    };
}

module.exports = { createVoiceSessionGuard, VOICE_IDLE_TIMEOUT_MS };
