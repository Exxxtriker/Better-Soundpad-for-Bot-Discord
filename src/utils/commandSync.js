function getLocalCommands(client) {
    if (!client.commands || typeof client.commands.values !== 'function') {
        throw new Error('A coleção local de comandos não foi carregada.');
    }

    const names = new Set();
    const commands = [];

    for (const command of client.commands.values()) {
        if (command?.data && typeof command.data.toJSON === 'function') {
            const data = command.data.toJSON();

            if (names.has(data.name)) {
                throw new Error(`Comando duplicado encontrado: /${data.name}`);
            }

            names.add(data.name);
            commands.push(data);
        }
    }

    return commands;
}

function commandSetsEqual(remoteCommands, localCommands) {
    if (remoteCommands.size !== localCommands.length) return false;

    return localCommands.every((localCommand) => {
        const commandType = localCommand.type || 1;
        const remoteCommand = remoteCommands.find((command) => (
            command.name === localCommand.name && command.type === commandType
        ));

        return Boolean(remoteCommand?.equals?.(localCommand));
    });
}

async function clearLegacyGuildCommands(client) {
    const guilds = [...client.guilds.cache.values()];
    const results = await Promise.all(guilds.map(async (guild) => {
        try {
            const guildCommands = await guild.commands.fetch();
            if (guildCommands.size > 0) await guild.commands.set([]);
            return { guildId: guild.id, cleared: guildCommands.size > 0 };
        } catch (error) {
            return {
                error: new Error(`Servidor ${guild.id}: ${error.message}`, { cause: error }),
            };
        }
    }));
    const failures = results.filter((result) => result.error).map((result) => result.error);

    if (failures.length) {
        throw new AggregateError(failures, 'Não foi possível limpar comandos antigos em todos os servidores.');
    }

    return results.filter((result) => result.cleared).map((result) => result.guildId);
}

async function syncApplicationCommands(client) {
    if (!client.application?.commands) {
        throw new Error('O gerenciador de comandos da aplicação não está disponível.');
    }

    const localCommands = getLocalCommands(client);
    const remoteCommands = await client.application.commands.fetch();
    let globalCommandsUpdated = false;

    if (!commandSetsEqual(remoteCommands, localCommands)) {
        await client.application.commands.set(localCommands);
        globalCommandsUpdated = true;
    }

    const clearedGuilds = await clearLegacyGuildCommands(client);

    return {
        globalCommandsUpdated,
        commandCount: localCommands.length,
        clearedGuilds,
    };
}

module.exports = {
    clearLegacyGuildCommands,
    commandSetsEqual,
    getLocalCommands,
    syncApplicationCommands,
};
