const { AudioPlayerStatus } = require('@discordjs/voice');
const {
    advanceCustomQueue,
    getPlatformIcon,
    guildQueues,
    prefetchNextSong,
    playNextAvailable,
    stopCustomQueue,
    updateMessage,
} = require('../commands/music/play');

const MUSIC_BUTTONS = new Set([
    'music_prev',
    'music_pause',
    'music_skip',
    'music_stop',
    'music_loop',
    'music_shuffle',
    'music_queue',
]);

module.exports = async (interaction) => {
    if (!interaction.isButton() || !MUSIC_BUTTONS.has(interaction.customId)) return;
    if (!interaction.inGuild()) return;

    const { guildId } = interaction;
    const queue = guildQueues.get(guildId);

    if (!queue) {
        await interaction.reply({ content: '❌ Não há nenhuma música tocando no momento!', flags: 64 });
        return;
    }

    const voiceChannelId = queue.connection?.joinConfig?.channelId;
    if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== voiceChannelId) {
        await interaction.reply({
            content: '⚠️ Entre no mesmo canal de voz do bot para usar estes controles.',
            flags: 64,
        });
        return;
    }

    await interaction.deferUpdate();

    try {
        switch (interaction.customId) {
        case 'music_pause':
            if (queue.paused && queue.player.state.status === AudioPlayerStatus.Idle && queue.songs.length) {
                if (queue.starting) throw new Error('A fila já está sendo preparada.');
                queue.starting = true;
                try {
                    await playNextAvailable(guildId);
                } finally {
                    queue.starting = false;
                }
            } else if (queue.paused) {
                queue.player.unpause();
                queue.paused = false;
            } else {
                queue.player.pause();
                queue.paused = true;
            }
            await updateMessage(guildId);
            break;

        case 'music_skip':
            await advanceCustomQueue(guildId);
            await updateMessage(guildId);
            break;

        case 'music_prev':
            if (!await advanceCustomQueue(guildId, 'previous')) throw new Error('Não há música anterior.');
            await updateMessage(guildId);
            break;

        case 'music_stop':
            await stopCustomQueue(guildId);
            break;

        case 'music_loop':
            {
                const modes = ['off', 'song', 'queue'];
                queue.loop = modes[(modes.indexOf(queue.loop) + 1) % modes.length];
            }
            await updateMessage(guildId);
            break;

        case 'music_shuffle':
            {
                const current = queue.songs.shift();
                queue.songs.sort(() => Math.random() - 0.5);
                if (current) queue.songs.unshift(current);
                prefetchNextSong(queue);
            }
            await updateMessage(guildId);
            break;

        case 'music_queue': {
            const songs = queue.songs ?? [];
            if (songs.length === 0) throw new Error('A fila está vazia.');
            const list = songs.slice(0, 10).map((song, index) => {
                const position = index === 0 ? '▶️' : `\`${index}.\``;
                return `${position} ${getPlatformIcon(song)} **${song.title ?? song.name}** \`${song.formattedDuration ?? '?:??'}\``;
            }).join('\n');
            const extra = songs.length > 10 ? `\n...e mais **${songs.length - 10}** músicas.` : '';
            await interaction.followUp({ content: `🎶 **Fila atual:**\n${list}${extra}`, flags: 64 });
            break;
        }

        default:
            break;
        }
    } catch (error) {
        console.error('Erro ao controlar player de música:', error);
        await interaction.followUp({ content: `❌ ${error.message || 'Não foi possível executar o controle.'}`, flags: 64 });
    }
};
