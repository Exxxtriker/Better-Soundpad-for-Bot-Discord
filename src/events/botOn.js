const { ActivityType, Events } = require('discord.js');
const { syncApplicationCommands } = require('../utils/commandSync');

const activityIntervals = new WeakMap();
const STARTUP_BANNER = [
    '┏┓• ┓        ┏┳┓┓     ┓      ┓',
    '┃┓┓┏┫┏┓┏┓┏┓   ┃ ┣┓┏┓  ┣┓┏┓┏┓┏┫',
    '┗┛┗┗┻┗ ┗┛┛┗   ┻ ┛┗┗   ┗┛┗┻┛ ┗┻',
].join('\n');

function createStartupBanner(latency, serverCount, options = {}) {
    const {
        color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb',
        columns = process.stdout.columns ?? 80,
    } = options;
    const latencyText = Number.isFinite(latency) && latency >= 0 ? `${Math.round(latency)} ms` : 'Aguardando';
    const serversText = Number.isInteger(serverCount) && serverCount >= 0 ? String(serverCount) : 'Indisponível';
    const paint = (text, code) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
    const stats = [
        ['STATUS', 'ONLINE', '32'],
        ['LATÊNCIA', latencyText, '36'],
        ['SERVIDORES', serversText, '37'],
    ];

    // Sem comandos de cursor: não apaga erros e continua legível em arquivos de log.
    if (columns < 40) {
        return [
            '', paint(STARTUP_BANNER, '1;33'), '',
            ...stats.map(([label, value, shade]) => paint(`${label}: ${value}`, shade)),
            'Erros: logs/log.txt', '',
        ].join('\n');
    }

    const width = Math.min(56, columns - 2);
    const border = (left, right) => paint(`${left}${'─'.repeat(width)}${right}`, '90');
    const row = (text = '', shade = '37', centered = false) => {
        const content = text.slice(0, width - 4);
        const left = centered ? Math.floor((width - content.length) / 2) : 2;
        const padded = `${' '.repeat(left)}${content}`.padEnd(width);
        return `${paint('│', '90')}${paint(padded, shade)}${paint('│', '90')}`;
    };

    return [
        '',
        border('╭', '╮'),
        row(),
        ...STARTUP_BANNER.split('\n').map((line) => row(line, '1;33', true)),
        row(),
        row('RPG  /  MÚSICA  /  AVENTURAS', '90', true),
        row(),
        border('├', '┤'),
        row(),
        ...stats.map(([label, value, shade]) => row(`${label.padEnd(13)}${value}`, shade)),
        row(),
        border('├', '┤'),
        row('ERROS        logs/log.txt', '90'),
        row('Ctrl+C para encerrar', '90'),
        border('╰', '╯'),
        '',
    ].join('\n');
}

function canUpdatePresence(bot) {
    return Boolean(bot.user && bot.isReady() && bot.ws?.shards?.size > 0);
}

function isMissingShardError(error) {
    return error instanceof RangeError && /^Shard \d+ not found$/.test(error.message);
}

function getBotReach(bot) {
    const guilds = [...(bot.guilds?.cache?.values?.() ?? [])];
    const memberCount = guilds.reduce((total, guild) => {
        const guildMembers = Number(guild.memberCount);
        return total + (Number.isFinite(guildMembers) && guildMembers > 0 ? guildMembers : 0);
    }, 0);
    return { memberCount: Math.floor(memberCount), serverCount: guilds.length };
}

function createReachStatus(bot) {
    const { memberCount, serverCount } = getBotReach(bot);
    const peopleLabel = memberCount === 1 ? 'pessoa' : 'pessoas';
    const serversLabel = serverCount === 1 ? 'servidor' : 'servidores';
    return `👥 ${memberCount.toLocaleString('pt-BR')} ${peopleLabel} • 🏰 ${serverCount.toLocaleString('pt-BR')} ${serversLabel}`;
}

function stopActivityRotation(bot) {
    const interval = activityIntervals.get(bot);
    if (!interval) return false;
    clearInterval(interval);
    activityIntervals.delete(bot);
    return true;
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(bot) {
        const requestStartedAt = Date.now();
        await bot.guilds.fetch();
        const requestLatency = Date.now() - requestStartedAt;
        const gatewayLatency = bot.ws.ping;
        const latency = Number.isFinite(gatewayLatency) && gatewayLatency >= 0
            ? gatewayLatency
            : requestLatency;
        process.stdout.write(createStartupBanner(latency, bot.guilds.cache.size));

        // Status personalizados exibidos no balão do perfil do bot.
        const activities = [
            {
                state: '🎲 Role dados e comece sua aventura!',
                type: ActivityType.Custom,
            },
            {
                state: '🎵 Música para suas campanhas',
                type: ActivityType.Custom,
            },
            {
                state: '💞 Haruka Harano',
                type: ActivityType.Custom,
            },
            {
                state: '⚒️ Feito por @Exxxtriker',
                type: ActivityType.Custom,
            },
            {
                state: '⚔️ Use /help',
                type: ActivityType.Custom,
            },
            {
                state: () => createReachStatus(bot),
                type: ActivityType.Custom,
            },
        ];

        let currentIndex = 0; // Inicia o índice da rotação de atividades

        // Função para alternar entre as atividades
        function updateActivity() {
            if (!canUpdatePresence(bot)) return;
            const activity = activities[currentIndex];
            const activityState = typeof activity.state === 'function'
                ? activity.state()
                : activity.state;

            try {
                bot.user.setPresence({
                    status: 'online',
                    activities: [{
                        name: 'Custom Status',
                        state: activityState,
                        type: activity.type,
                    }],
                });
            } catch (error) {
                if (!isMissingShardError(error)) {
                    console.error('Erro ao atualizar atividade do Discord:', error);
                }
                return;
            }

            // Incrementa o índice para a próxima atividade (faz rotação)
            currentIndex = (currentIndex + 1) % activities.length;
        }

        // Atualiza a atividade a cada 25 segundos.
        stopActivityRotation(bot);
        const activityInterval = setInterval(updateActivity, 25000);
        activityInterval.unref();
        activityIntervals.set(bot, activityInterval);

        // Inicializa a primeira atividade imediatamente
        updateActivity();

        // Mantém o Discord igual aos arquivos locais e remove registros antigos de servidor.
        await syncApplicationCommands(bot);
    },
    canUpdatePresence,
    createReachStatus,
    createStartupBanner,
    getBotReach,
    isMissingShardError,
    stopActivityRotation,
};
