const { Collection } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async (client) => {
    client.commands = new Collection();

    const commandsPath = path.join(__dirname, '../commands/');
    const commandsDirs = fs.readdirSync(commandsPath);

    for (const dir of commandsDirs) {
        const dirPath = path.join(commandsPath, dir);
        const commandFiles = fs.readdirSync(dirPath).filter((file) => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(dirPath, file);
            const command = require(filePath);
            client.commands.set(command.data.name, command);
        }
    }
};
