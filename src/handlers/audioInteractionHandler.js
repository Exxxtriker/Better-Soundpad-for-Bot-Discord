const activePlayers = require('./activePlayers');

const AUDIO_MENU_IDS = new Set(['soundpad_category', 'soundpad_select']);
const AUDIO_BUTTONS = new Set([
    'soundpad_resume',
    'soundpad_pause',
    'soundpad_stop_background',
    'soundpad_stop_effect',
    'soundpad_close',
    'soundpad_loop',
    'soundpad_background_up',
    'soundpad_background_down',
    'soundpad_effect_up',
    'soundpad_effect_down',
    'soundpad_layer',
    'soundpad_next',
    'soundpad_previous',
    'soundpad_reload',
]);
const EXPECTED_DISCORD_ERRORS = new Set([10008, 10062, 40060]);

function isExpectedInteractionError(error) {
    return EXPECTED_DISCORD_ERRORS.has(Number(error?.code));
}

async function safelyReply(interaction, payload) {
    try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
        return true;
    } catch (error) {
        if (isExpectedInteractionError(error)) return false;
        throw error;
    }
}

async function safelyDeferUpdate(interaction) {
    try {
        await interaction.deferUpdate();
        return true;
    } catch (error) {
        if (isExpectedInteractionError(error)) return false;
        throw error;
    }
}

async function updateSoundpad(interaction, playerManager, isAudioMenu) {
    let feedback;

    if (isAudioMenu) {
        if (interaction.customId === 'soundpad_category') {
            if (!playerManager.selectCategory(interaction.values[0])) {
                throw new Error('Essa categoria não está mais disponível. Recarregue o soundpad.');
            }
        } else {
            const selectedIndex = Number.parseInt(interaction.values[0], 10);
            const selectedAudio = playerManager.getAudioPage()[selectedIndex];
            if (!selectedAudio || !playerManager.playAudio(selectedAudio.audioName)) {
                throw new Error('Esse áudio não está mais disponível. Recarregue o soundpad.');
            }
        }
        await playerManager.updateMessage?.();
        return;
    }

    switch (interaction.customId) {
    case 'soundpad_resume':
        playerManager.unpause();
        break;
    case 'soundpad_pause':
        playerManager.pause();
        break;
    case 'soundpad_stop_background':
        playerManager.stopLayer('background');
        break;
    case 'soundpad_stop_effect':
        playerManager.stopLayer('effect');
        break;
    case 'soundpad_close':
        playerManager.destroy();
        await interaction.message.delete().catch((error) => {
            if (!isExpectedInteractionError(error)) throw error;
        });
        return;
    case 'soundpad_loop':
        playerManager.toggleLoop();
        break;
    case 'soundpad_background_up':
        playerManager.setVolume('background', playerManager.volumes.background + 0.1);
        break;
    case 'soundpad_background_down':
        playerManager.setVolume('background', playerManager.volumes.background - 0.1);
        break;
    case 'soundpad_effect_up':
        playerManager.setVolume('effect', playerManager.volumes.effect + 0.1);
        break;
    case 'soundpad_effect_down':
        playerManager.setVolume('effect', playerManager.volumes.effect - 0.1);
        break;
    case 'soundpad_layer':
        playerManager.togglePlaybackLayer();
        break;
    case 'soundpad_next':
        playerManager.currentPage = Math.min(
            playerManager.currentPage + 1,
            playerManager.getTotalPages(),
        );
        break;
    case 'soundpad_previous':
        playerManager.currentPage = Math.max(playerManager.currentPage - 1, 1);
        break;
    case 'soundpad_reload':
        {
            const result = playerManager.reloadAudioList();
            const changes = [
                result.added.length > 0 ? `➕ ${result.added.length} novo(s)` : null,
                result.removed.length > 0 ? `➖ ${result.removed.length} removido(s)` : null,
            ].filter(Boolean).join(' • ');
            feedback = [
                '✅ **Catálogo do soundpad atualizado!**',
                `🎼 ${result.audioCount} áudio(s) em ${result.categoryCount} categoria(s).`,
                changes || 'Nenhuma alteração encontrada.',
            ].join('\n');
        }
        break;
    default:
        return;
    }

    await playerManager.updateMessage?.();
    if (feedback) {
        await safelyReply(interaction, { content: feedback, flags: 64 });
    }
}

async function audioInteractionHandler(interaction) {
    const isAudioMenu = interaction.isStringSelectMenu()
        && AUDIO_MENU_IDS.has(interaction.customId);
    const isAudioButton = interaction.isButton() && AUDIO_BUTTONS.has(interaction.customId);
    if (!isAudioMenu && !isAudioButton) return;
    if (!interaction.inGuild()) return;

    const playerManager = activePlayers.get(interaction.guildId);
    const isCurrentPanel = playerManager?.sentMessage?.id === interaction.message?.id;
    if (!playerManager || playerManager.destroyed || !isCurrentPanel) {
        await safelyReply(interaction, {
            content: '⚠️ Este painel do soundpad não está mais ativo.',
            flags: 64,
        });
        return;
    }

    if (interaction.member?.voice?.channelId !== playerManager.voiceChannel.id) {
        await safelyReply(interaction, {
            content: '⚠️ Entre no mesmo canal de voz do bot para usar estes controles.',
            flags: 64,
        });
        return;
    }

    if (!await safelyDeferUpdate(interaction)) return;

    try {
        await playerManager.enqueueControl(() => updateSoundpad(
            interaction,
            playerManager,
            isAudioMenu,
        ));
    } catch (error) {
        if (isExpectedInteractionError(error)) return;
        console.error('Erro ao controlar o soundpad:', error);
        await safelyReply(interaction, {
            content: `❌ ${error.message || 'Não foi possível executar este controle.'}`,
            flags: 64,
        });
    }
}

module.exports = audioInteractionHandler;
module.exports.AUDIO_BUTTONS = AUDIO_BUTTONS;
module.exports.AUDIO_MENU_IDS = AUDIO_MENU_IDS;
module.exports.isExpectedInteractionError = isExpectedInteractionError;
module.exports.safelyDeferUpdate = safelyDeferUpdate;
