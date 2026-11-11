/* eslint-disable import/order -- o logger precisa iniciar antes dos outros módulos da aplicação. */
const {
    installErrorLogger,
    registerRuntimeErrorSources,
    reportCriticalError,
    writeErrorLog,
} = require('./src/utils/errorLogger');
const { enableErrorOnlyConsole } = require('./src/utils/errorOnlyConsole');

enableErrorOnlyConsole();
installErrorLogger();

const dns = require('node:dns');
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const { token } = require('./config');
const { stopActivityRotation } = require('./src/events/botOn');
const { configureDnsResolver, PUBLIC_DNS_SERVERS } = require('./src/utils/dnsResolver');
const { loginWithRetry } = require('./src/utils/discordLogin');
const { guildQueues, stopCustomQueue } = require('./src/commands/music/play');
const activePlayers = require('./src/handlers/activePlayers');
/* eslint-enable import/order */

const MONGO_OPTIONS = { serverSelectionTimeoutMS: 10_000 };
const startupAbortController = new AbortController();
let shuttingDown = false;

configureDnsResolver();

// Criação do client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

require('./src/handlers/eventsHandler')(client);
require('./src/handlers/commandsHandler')(client);

const audioInteractionHandler = require('./src/handlers/audioInteractionHandler');

client.on('interactionCreate', (interaction) => {
    audioInteractionHandler(interaction).catch((error) => console.error('Erro no player de áudio:', error));
});

registerRuntimeErrorSources({
    client,
});

const musicInteractionHandler = require('./src/handlers/musicInteractionHandler');

client.on('interactionCreate', (interaction) => {
    musicInteractionHandler(interaction).catch((error) => console.error('Erro no player de música:', error));
});

const carouselInteractionHandler = require('./src/handlers/carouselInteractionHandler');

client.on('interactionCreate', (interaction) => {
    carouselInteractionHandler.handleCarouselInteraction(interaction)
        .catch((error) => console.error('Erro no carrossel:', error));
});

async function connectMongo() {
    try {
        await mongoose.connect(process.env.MONGO_URI, MONGO_OPTIONS);
    } catch (error) {
        const isSrvDnsRefusal = error.code === 'ECONNREFUSED' && error.syscall === 'querySrv';
        const fallbackEnabled = process.env.CUSTOM_DNS !== 'false';
        if (!isSrvDnsRefusal || !fallbackEnabled) throw error;

        writeErrorLog('RECOVERED_ERROR', [
            'Falha inicial de DNS ao conectar ao MongoDB; tentando DNS público:',
            error,
        ]);
        await mongoose.disconnect().catch((disconnectError) => {
            console.error('Erro ao preparar a nova tentativa do MongoDB:', disconnectError);
        });
        dns.setServers(PUBLIC_DNS_SERVERS);
        await mongoose.connect(process.env.MONGO_URI, MONGO_OPTIONS);
    }
}

async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    startupAbortController.abort();
    stopActivityRotation(client);
    for (const manager of activePlayers.values()) {
        try {
            manager.destroy?.({ deleteMessage: true });
        } catch (error) {
            console.error('Erro ao encerrar soundpad:', error);
        }
    }
    const results = await Promise.allSettled([...guildQueues.keys()].map(stopCustomQueue));
    results.forEach((result) => {
        if (result.status === 'rejected') console.error('Erro ao encerrar fila de música:', result.reason);
    });
    try {
        await client.destroy();
    } catch (error) {
        console.error('Erro ao encerrar o cliente Discord:', error);
    }
    await mongoose.disconnect().catch((error) => console.error('Erro ao desconectar MongoDB:', error));
}

async function start() {
    try {
        if (!process.env.MONGO_URI) throw new Error('Variável de ambiente ausente: MONGO_URI');
        await connectMongo();
        if (shuttingDown) {
            await mongoose.disconnect();
            return;
        }
        registerRuntimeErrorSources({ databaseConnection: mongoose.connection });
        await loginWithRetry(client, token, {
            signal: startupAbortController.signal,
            onRetry: (error, retry) => writeErrorLog('RECOVERED_ERROR', [
                `Falha temporária ao conectar ao Discord. Tentativa ${retry.attempt}; nova tentativa em ${retry.delay / 1_000}s.`,
                error,
            ]),
        });
    } catch (error) {
        if (shuttingDown) return;
        reportCriticalError('Falha ao iniciar o bot:', error);
        process.exitCode = 1;
        await shutdown();
    }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

start();
