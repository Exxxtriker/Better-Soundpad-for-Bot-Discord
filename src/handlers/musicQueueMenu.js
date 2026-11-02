const { randomUUID } = require('node:crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    StringSelectMenuBuilder, escapeMarkdown, parseEmoji,
} = require('discord.js');
const {
    guildQueues, getPlatformIcon, getSongPlatform, prioritizeQueuedSong,
} = require('../commands/music/play');
const { guardComponentHandler } = require('../utils/componentHandler');

const PAGE_SIZE = 25;
const SELECT_ID = 'music_priority_select';
const PREVIOUS_ID = 'music_priority_previous';
const NEXT_ID = 'music_priority_next';
const CLOSE_ID = 'music_priority_close';
const CONTROL_IDS = new Set([SELECT_ID, PREVIOUS_ID, NEXT_ID, CLOSE_ID]);
const EXPECTED_ERRORS = new Set(['MUSIC_QUEUE_CHANGED', 'MUSIC_QUEUE_BUSY', 'MUSIC_TRACK_CURRENT']);
const songIds = new WeakMap();

function getQueuedSongId(song) {
    if (!songIds.has(song)) songIds.set(song, randomUUID());
    return songIds.get(song);
}

function songName(song, maxLength = 45) {
    return String(song?.title ?? song?.name ?? 'Balada desconhecida').replace(/\s+/g, ' ').slice(0, maxLength);
}

function buildQueueMenu(queue, requestedPage = 0) {
    const pending = queue.songs.slice(1);
    const totalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(totalPages - 1, requestedPage));
    const start = page * PAGE_SIZE;
    const tracks = pending.slice(start, start + PAGE_SIZE);
    const lines = tracks.map((song, index) => (
        `**${start + index + 1}.** ${getPlatformIcon(song)} ${escapeMarkdown(songName(song))}`
    ));
    const embed = new EmbedBuilder()
        .setColor(0xC9A227)
        .setTitle('📜 Pergaminho das baladas')
        .setDescription([
            `🎻 Agora: **${escapeMarkdown(songName(queue.songs[0], 90))}**`,
            '',
            lines.length ? lines.join('\n') : '*Não há outras músicas aguardando.*',
            '',
            'Escolha uma faixa para **tocar agora**. As demais continuam na mesma ordem.',
        ].join('\n'))
        .setFooter({ text: `Página ${page + 1}/${totalPages} • ${pending.length} faixa(s) aguardando` });
    const components = [];
    if (tracks.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder('Qual balada deseja ouvir agora?')
            .addOptions(tracks.map((song, index) => ({
                label: `${start + index + 1}. ${songName(song, 90)}`.slice(0, 100),
                value: getQueuedSongId(song),
                description: `${getSongPlatform(song)} • ${song.formattedDuration ?? 'Duração desconhecida'}`.slice(0, 100),
                emoji: parseEmoji(getPlatformIcon(song)) ?? '🎵',
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PREVIOUS_ID).setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder().setCustomId(NEXT_ID).setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1),
        new ButtonBuilder().setCustomId(CLOSE_ID).setLabel('Fechar').setStyle(ButtonStyle.Secondary),
    ));
    return {
        page,
        data: {
            content: null, embeds: [embed], components, allowedMentions: { parse: [] },
        },
    };
}

async function openMusicQueue(interaction) {
    const queue = guildQueues.get(interaction.guildId);
    if (!queue) throw new Error('Esta fila já foi encerrada.');
    let view = buildQueueMenu(queue);
    const message = await interaction.followUp({ ...view.data, flags: 64 });
    const edit = (payload) => interaction.webhook.editMessage(message.id, payload);
    const collector = message.createMessageComponentCollector({
        time: 180_000,
        filter: (component) => component.user.id === interaction.user.id && CONTROL_IDS.has(component.customId),
    });
    let active = true;
    let controls = Promise.resolve();
    collector.on('collect', guardComponentHandler(async (component) => {
        if (component.member?.voice?.channelId !== queue.connection.joinConfig.channelId) {
            await component.reply({ content: '⚠️ Entre no mesmo canal de voz do bot para escolher uma faixa.', flags: 64 });
            return;
        }
        await component.deferUpdate();
        const operation = controls.then(async () => {
            if (!active) return;
            if (guildQueues.get(interaction.guildId) !== queue) {
                collector.stop('closed');
                await edit({ content: '📜 Esta fila foi encerrada. Abra o Pergaminho no painel atual.', embeds: [], components: [] });
                return;
            }
            if (component.customId === CLOSE_ID) {
                collector.stop('closed');
                await edit({ content: '📜 Pergaminho fechado.', embeds: [], components: [] });
                return;
            }
            if (component.customId === SELECT_ID) {
                const song = queue.songs.find((item) => getQueuedSongId(item) === component.values[0]);
                try {
                    const playing = await prioritizeQueuedSong(interaction.guildId, song);
                    collector.stop('selected');
                    await edit({
                        content: playing
                            ? `🎶 **${escapeMarkdown(songName(song, 120))}** recebeu prioridade. Depois dela, a fila segue na ordem anterior.`
                            : '⚠️ Essa faixa não pôde ser reproduzida. A fila continuou com as músicas restantes.',
                        embeds: [],
                        components: [],
                        allowedMentions: { parse: [] },
                    });
                    return;
                } catch (error) {
                    if (!EXPECTED_ERRORS.has(error.code)) throw error;
                    view = buildQueueMenu(queue, view.page);
                    await edit({ ...view.data, content: `⚠️ ${error.message}` });
                    return;
                }
            }
            const direction = component.customId === NEXT_ID ? 1 : -1;
            view = buildQueueMenu(queue, view.page + direction);
            await edit(view.data);
        });
        controls = operation.catch(() => {});
        await operation;
    }, 'Erro ao escolher música da fila:'));
    collector.on('end', (_, reason) => {
        active = false;
        if (reason === 'selected' || reason === 'closed') return;
        controls.then(() => edit({ components: [] })).catch((error) => {
            if (![10008, 10062].includes(Number(error.code))) console.error('Erro ao encerrar seleção da fila:', error);
        });
    });
}

module.exports = { buildQueueMenu, getQueuedSongId, openMusicQueue };
