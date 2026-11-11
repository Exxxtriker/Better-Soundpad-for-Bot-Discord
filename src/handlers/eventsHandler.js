const fs = require('node:fs');
const path = require('node:path');

module.exports = async (client) => {
    const eventsPath = path.join(__dirname, '../events');
    const eventsFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

    for (const file of eventsFiles) {
        const fileOf = path.join(eventsPath, file);
        const event = require(fileOf);
        const execute = (...args) => {
            Promise.resolve(event.execute(...args)).catch((error) => {
                console.error(`Erro no evento ${event.name}:`, error);
            });
        };

        if (event.once) client.once(event.name, execute);
        else client.on(event.name, execute);
    }
};
