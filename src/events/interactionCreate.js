/* eslint-disable max-len */
const { Events } = require('discord.js');
const { addInteraction, checkEmblems } = require('../utils/profileManager');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, dependencies = { addInteraction, checkEmblems }) {
        if (interaction.isAutocomplete?.()) {
            const autocompleteCommand = interaction.client.commands.get(interaction.commandName);
            if (typeof autocompleteCommand?.autocomplete === 'function') {
                await autocompleteCommand.autocomplete(interaction).catch(async (error) => {
                    console.error(`Erro no autocomplete de /${interaction.commandName}:`, error);
                    await interaction.respond([]).catch(() => {});
                });
            }
            return;
        }
        const { user } = interaction;
        const { guildId } = interaction;

        const grantProgress = async (checkUnlocks) => {
            if (!guildId) return { newEmblems: [], newRewards: [] };
            try {
                const profile = await dependencies.addInteraction(guildId, user.id, user.username);
                return checkUnlocks
                    ? await dependencies.checkEmblems(profile)
                    : { newEmblems: [], newRewards: [] };
            } catch (profileErr) {
                console.error('Erro ao atualizar perfil:', profileErr);
                return { newEmblems: [], newRewards: [] };
            }
        };

        if (!interaction.isChatInputCommand()) {
            await grantProgress(false);
            return;
        }

        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            await grantProgress(false);
            return;
        }

        const awardBeforeCommand = interaction.commandName === 'perfil';
        let unlocks = { newEmblems: [], newRewards: [] };

        if (awardBeforeCommand) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ flags: 0 }).catch((error) => {
                    console.error('Erro ao preparar o comando /perfil:', error);
                });
            }
            unlocks = await grantProgress(true);
        }

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error('Erro ao processar interação:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '⚠️ Houve um erro ao executar este comando.',
                        flags: 64, // 64 = ephemeral flag
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '⚠️ Houve um erro ao executar este comando.',
                    });
                }
            } catch (replyErr) {
                console.error('Erro ao tentar responder após falha:', replyErr);
            }
        } finally {
            if (!awardBeforeCommand) unlocks = await grantProgress(true);
        }

        const { newEmblems, newRewards } = unlocks;
        if (!interaction.isRepliable() || (newEmblems.length === 0 && newRewards.length === 0)) return;
        const notification = {
            content: `${user}, você desbloqueou:\n🏅 Emblemas: ${newEmblems.join(', ') || 'nenhum'}\n🎁 Recompensas: ${newRewards.join(', ') || 'nenhuma'}`,
            flags: 64,
        };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(notification).catch(() => {});
        } else {
            await interaction.reply(notification).catch(() => {});
        }
    },
};
