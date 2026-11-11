const { SlashCommandBuilder } = require('discord.js');
const engine = require('../../utils/diceEngine');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Rola dados ou calcula uma expressão matemática')
        .addStringOption((option) => option.setName('expressao')
            .setDescription('Ex.: 1d20+7, 10x10+78 ou 85+50%')
            .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        let response;
        try {
            response = { content: engine.rollExpression(interaction.options.getString('expressao')), allowedMentions: { parse: [] } };
        } catch (error) {
            response = { content: `❌ ${error.message}`, flags: 64, allowedMentions: { parse: [] } };
        }
        await interaction.reply(response);
    },
    ...engine,
    calculateExpression: engine.rollExpression,
    parseArithmeticExpression: (rawInput) => engine.parseRollExpression(rawInput).tree,
};
