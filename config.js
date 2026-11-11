require('dotenv').config();

const requiredVariables = ['TOKEN', 'CLIENT_ID'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

if (missingVariables.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missingVariables.join(', ')}`);
}

module.exports = {
    clientId: process.env.CLIENT_ID,
    token: process.env.TOKEN,
};
