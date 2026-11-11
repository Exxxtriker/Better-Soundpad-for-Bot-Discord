const fs = require('node:fs');
const path = require('node:path');

const commandsRoot = path.join(__dirname, '..', 'src', 'commands');
const commandNames = new Set();

for (const directoryEntry of fs.readdirSync(commandsRoot, { withFileTypes: true })) {
    if (directoryEntry.isDirectory()) {
        const directoryPath = path.join(commandsRoot, directoryEntry.name);
        const commandFiles = fs.readdirSync(directoryPath).filter((file) => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(directoryPath, file);
            const command = require(filePath);
            const commandData = command.data?.toJSON();

            if (!commandData?.name || typeof command.execute !== 'function') {
                throw new Error(`Comando inválido: ${filePath}`);
            }
            if (commandNames.has(commandData.name)) {
                throw new Error(`Nome de comando duplicado: ${commandData.name}`);
            }

            commandNames.add(commandData.name);
        }
    }
}
