const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PREVIOUS_ID = 'carousel_previous';
const NEXT_ID = 'carousel_next';
const CAROUSEL_BUTTONS = new Set([PREVIOUS_ID, NEXT_ID]);
const sessions = new Map();

function preloadPosition(session, position) {
    if (position < 0 || position >= session.total) return;
    setImmediate(() => {
        Promise.resolve(session.render(position)).catch(() => {});
    });
}

function buildCarouselControls(position, total, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(PREVIOUS_ID)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || position <= 0),
        new ButtonBuilder()
            .setCustomId(NEXT_ID)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || position >= total - 1),
    );
}

async function registerCarousel(interaction, options) {
    const message = await interaction.fetchReply();
    const session = {
        messageId: message.id,
        ownerId: options.ownerId || interaction.user.id,
        position: options.position || 0,
        renderedPosition: options.position || 0,
        total: options.total,
        render: options.render,
        edit: (payload) => interaction.editReply(payload),
        active: true,
        processing: false,
        queue: Promise.resolve(),
    };
    sessions.set(session.messageId, session);
    preloadPosition(session, session.position + 1);

    const timeout = options.timeout || 180_000;
    const timer = setTimeout(async () => {
        if (sessions.get(session.messageId) !== session) return;
        sessions.delete(session.messageId);
        session.active = false;
        await session.queue.catch(() => {});
        await interaction.editReply({
            components: [buildCarouselControls(session.position, session.total, true)],
        }).catch(() => {});
    }, timeout);
    timer.unref?.();
    return session;
}

async function processPendingNavigation(session) {
    if (!session.active || session.renderedPosition === session.position) return;
    const nextPosition = session.position;
    const payload = await session.render(nextPosition);
    await session.edit(payload);
    session.renderedPosition = nextPosition;
    preloadPosition(session, nextPosition + session.lastDirection);
    await processPendingNavigation(session);
}

function enqueueNavigation(session, direction) {
    session.position = Math.max(
        0,
        Math.min(session.total - 1, session.position + direction),
    );
    session.lastDirection = direction;
    if (session.processing) return session.queue;

    session.processing = true;
    session.queue = processPendingNavigation(session).finally(() => {
        session.processing = false;
    });
    return session.queue;
}

async function handleCarouselInteraction(interaction) {
    if (!interaction.isButton?.() || !CAROUSEL_BUTTONS.has(interaction.customId)) {
        return false;
    }

    const session = sessions.get(interaction.message?.id);
    if (!session) {
        await interaction.reply({
            content: '📜 Este carrossel expirou. Execute o comando novamente.',
            flags: 64,
        }).catch(() => {});
        return true;
    }
    if (interaction.user.id !== session.ownerId) {
        await interaction.reply({
            content: '❌ Somente quem abriu este carrossel pode navegar.',
            flags: 64,
        }).catch(() => {});
        return true;
    }

    const direction = interaction.customId === NEXT_ID ? 1 : -1;
    await interaction.deferUpdate().catch(() => {});
    enqueueNavigation(session, direction).catch((error) => {
        if (error?.code !== 10008) console.error('Erro ao navegar pelo carrossel:', error);
    });
    return true;
}

function clearCarousels() {
    sessions.forEach((session) => {
        session.active = false;
    });
    sessions.clear();
}

module.exports = {
    buildCarouselControls,
    clearCarousels,
    handleCarouselInteraction,
    registerCarousel,
};
