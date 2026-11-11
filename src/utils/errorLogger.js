const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'log.txt');
const originalConsoleError = console.error.bind(console);
const MAX_ENTRY_LENGTH = 20_000;
const SECRET_ENV_KEYS = [
    'TOKEN',
    'MONGO_URI',
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
];
let installed = false;
const registeredClients = new WeakSet();
const registeredDatabaseConnections = new WeakSet();

function redactSecrets(text, environment = process.env) {
    return SECRET_ENV_KEYS.reduce((redacted, key) => {
        const secret = environment[key];
        if (typeof secret !== 'string' || secret.length < 4) return redacted;
        return redacted.split(secret).join('[SEGREDO_REMOVIDO]');
    }, String(text));
}

function formatError(error) {
    const context = {};
    const contextKeys = [
        'code',
        'errorCode',
        'errno',
        'syscall',
        'hostname',
        'platform',
        'requestedPlatform',
        'query',
        'track',
        'guild',
        'voiceChannel',
        'details',
    ];

    contextKeys.forEach((key) => {
        if (error[key] !== undefined) context[key] = error[key];
    });
    if (error.cause !== undefined) context.cause = error.cause;

    const heading = error.stack ?? `${error.name}: ${error.message}`;
    if (Object.keys(context).length === 0) return heading;
    return `${heading}\nContexto: ${inspect(context, {
        depth: 5,
        maxArrayLength: 50,
        maxStringLength: 5_000,
        breakLength: 120,
    })}`;
}

function formatValue(value) {
    if (value instanceof Error) return formatError(value);
    if (typeof value === 'string') return value;
    return inspect(value, {
        depth: 5,
        maxArrayLength: 50,
        maxStringLength: 5_000,
        breakLength: 120,
    });
}

function formatErrorEntry(level, values, environment = process.env, now = new Date()) {
    const body = redactSecrets(values.map(formatValue).join(' '), environment);
    const suffix = body.length > MAX_ENTRY_LENGTH ? '\n[REGISTRO TRUNCADO]' : '';
    return `[${now.toISOString()}] ${level}\n${body.slice(0, MAX_ENTRY_LENGTH)}${suffix}\n\n`;
}

function ensureLogFile(logFile = LOG_FILE) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.closeSync(fs.openSync(logFile, 'a'));
    return logFile;
}

function writeErrorLog(level, values, logFile = LOG_FILE) {
    ensureLogFile(logFile);
    fs.appendFileSync(logFile, formatErrorEntry(level, values), 'utf8');
}

function reportCriticalError(...values) {
    try {
        writeErrorLog('CRITICAL_ERROR', values);
        originalConsoleError(`❌ Erro crítico registrado em ${path.relative(process.cwd(), LOG_FILE)}`);
    } catch (loggingError) {
        originalConsoleError('❌ Erro crítico e falha ao gravar o log:', loggingError, ...values);
    }
}

function installErrorLogger() {
    if (installed) return LOG_FILE;

    ensureLogFile();
    const recordSafely = (level, values) => {
        try {
            writeErrorLog(level, values);
        } catch (loggingError) {
            originalConsoleError('Erro ao gravar logs:', loggingError);
        }
    };

    Object.assign(console, {
        error: (...values) => {
            recordSafely('ERROR', values);
        },
    });

    process.on('uncaughtException', (error) => {
        reportCriticalError('Exceção não tratada:', error);
        process.exit(1); // eslint-disable-line no-process-exit
    });

    process.on('unhandledRejection', (reason) => {
        reportCriticalError('Promise rejeitada sem tratamento:', reason);
        process.exit(1); // eslint-disable-line no-process-exit
    });

    installed = true;
    return LOG_FILE;
}

function registerRuntimeErrorSources({ client, databaseConnection } = {}) {
    if (client && typeof client.on === 'function' && !registeredClients.has(client)) {
        client.on('error', (error) => console.error('[Discord Client]', error));
        client.on('shardError', (error, shardId) => {
            console.error(`[Discord Shard ${shardId}]`, error);
        });
        registeredClients.add(client);
    }

    if (
        databaseConnection
        && typeof databaseConnection.on === 'function'
        && !registeredDatabaseConnections.has(databaseConnection)
    ) {
        databaseConnection.on('error', (error) => console.error('[MongoDB]', error));
        registeredDatabaseConnections.add(databaseConnection);
    }
}

module.exports = {
    LOG_FILE,
    ensureLogFile,
    formatErrorEntry,
    installErrorLogger,
    registerRuntimeErrorSources,
    reportCriticalError,
    redactSecrets,
    writeErrorLog,
};
