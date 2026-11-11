const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Profile = require('../../models/profile');

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 horas
const DAILY_MIN = 200; // mínimo de ouro
const DAILY_MAX = 1000; // máximo de ouro

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Receba sua recompensa diária de ouro 💰')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const userId = interaction.user.id;
            const { guildId } = interaction;
            const { username } = interaction.user;

            const now = new Date();
            const cooldownLimit = new Date(now.getTime() - DAILY_COOLDOWN);
            const reward = Math.floor(Math.random() * (DAILY_MAX - DAILY_MIN + 1)) + DAILY_MIN;

            await Profile.updateOne(
                { guildId, userId },
                { $set: { username }, $setOnInsert: { guildId, userId } },
                { upsert: true, setDefaultsOnInsert: true },
            );

            const profile = await Profile.findOneAndUpdate(
                {
                    guildId,
                    userId,
                    $or: [
                        { lastDaily: null },
                        { lastDaily: { $lte: cooldownLimit } },
                    ],
                },
                {
                    $inc: { money: reward },
                    $set: { lastDaily: now, username },
                },
                { new: true },
            );

            if (!profile) {
                const existingProfile = await Profile.findOne({ guildId, userId });
                const remaining = Math.max(0, DAILY_COOLDOWN - (now - existingProfile.lastDaily));
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

                const embed = new EmbedBuilder()
                    .setTitle('⏳ Daily já coletado!')
                    .setColor('#FF4500')
                    .setDescription(`Você já coletou sua recompensa diária.\nTente novamente em **${hours}h ${minutes}m ${seconds}s**.`)
                    .setFooter({ text: 'Volte amanhã para coletar novamente!' });

                return interaction.editReply({ embeds: [embed] });
            }

            // Mensagem customizada dependendo do valor
            let message = 'Você recebeu sua recompensa diária!';
            if (reward > 800) message = '🍀 Que sorte! Você recebeu uma grande quantia!';
            else if (reward < 400) message = '😅 Foi um dia fraco, mas ainda assim recebeu algo.';

            const embed = new EmbedBuilder()
                .setTitle('💰 Recompensa Diária Recebida!')
                .setColor('#FFD700')
                .setDescription(`${message}\nVocê ganhou **${reward} 🪙**.`)
                .setFooter({ text: 'Volte amanhã para coletar novamente!' });

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro no comando /daily:', error);
            const response = { content: '❌ Ocorreu um erro ao tentar coletar o daily.' };
            if (interaction.replied || interaction.deferred) return interaction.editReply(response);
            return interaction.reply({ ...response, flags: 64 });
        }
    },
};
