const {
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const mongoose = require('mongoose');
const Profile = require('../../models/profile');

const moneyFormatter = new Intl.NumberFormat('pt-BR');

function createTransferError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function transferCoins(transfer, dependencies = {}) {
    const ProfileModel = dependencies.ProfileModel || Profile;
    const connection = dependencies.connection || mongoose.connection;
    const {
        guildId,
        payerId,
        payerUsername,
        recipientId,
        recipientUsername,
        amount,
    } = transfer;

    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw createTransferError('INVALID_AMOUNT', 'A quantidade de moedas é inválida.');
    }
    if (payerId === recipientId) {
        throw createTransferError('SAME_USER', 'Você não pode transferir moedas para si mesmo.');
    }

    return connection.transaction(async (session) => {
        const payer = await ProfileModel.findOneAndUpdate(
            { guildId, userId: payerId, money: { $gte: amount } },
            {
                $inc: { money: -amount },
                $set: { username: payerUsername },
            },
            { new: true, session },
        );

        if (!payer) {
            throw createTransferError('INSUFFICIENT_COINS', 'Você não possui moedas suficientes.');
        }

        const recipient = await ProfileModel.findOneAndUpdate(
            { guildId, userId: recipientId },
            {
                $inc: { money: amount },
                $set: { username: recipientUsername },
                $setOnInsert: { guildId, userId: recipientId },
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
                session,
            },
        );

        return {
            payerBalance: payer.money,
            recipientBalance: recipient.money,
        };
    });
}

function createReceiptEmbed(payer, recipient, amount) {
    return new EmbedBuilder()
        .setColor(0xC9A227)
        .setAuthor({ name: '⚜️ BANCO DA GUILDA • REGISTRO DE PAGAMENTO' })
        .setTitle('🪙 Transferência concluída')
        .setDescription([
            `${payer} entregou uma bolsa de moedas para ${recipient}.`,
            '',
            `> **${moneyFormatter.format(amount)} moedas** mudaram de mãos.`,
        ].join('\n'))
        .setFooter({ text: 'A transação foi registrada nas crônicas da guilda.' })
        .setTimestamp();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pagar')
        .setDescription('Transfira moedas da sua bolsa para outro jogador.')
        .addUserOption((option) => option
            .setName('jogador')
            .setDescription('Jogador que receberá as moedas.')
            .setRequired(true))
        .addIntegerOption((option) => option
            .setName('quantidade')
            .setDescription('Quantidade de moedas que deseja transferir.')
            .setMinValue(1)
            .setMaxValue(1_000_000_000)
            .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        const recipient = interaction.options.getUser('jogador', true);
        const amount = interaction.options.getInteger('quantidade', true);

        if (recipient.id === interaction.user.id) {
            return interaction.reply({
                content: '❌ Você não pode pagar moedas para si mesmo.',
                flags: 64,
            });
        }

        if (recipient.bot) {
            return interaction.reply({
                content: '❌ Bots não possuem uma bolsa de aventureiro.',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const result = await transferCoins({
                guildId: interaction.guildId,
                payerId: interaction.user.id,
                payerUsername: interaction.user.username,
                recipientId: recipient.id,
                recipientUsername: recipient.username,
                amount,
            });
            const receipt = await interaction.channel.send({
                embeds: [createReceiptEmbed(interaction.user, recipient, amount)],
                allowedMentions: {
                    users: [interaction.user.id, recipient.id],
                },
            }).catch(async (error) => {
                console.error('Erro ao publicar comprovante do pagamento:', error);
                await interaction.editReply({
                    content: `✅ Pagamento concluído. Seu novo saldo é **${moneyFormatter.format(result.payerBalance)} moedas**.`,
                });
                return null;
            });

            if (receipt) await interaction.deleteReply().catch(() => {});
            return undefined;
        } catch (error) {
            if (error.code === 'INSUFFICIENT_COINS') {
                return interaction.editReply({
                    content: `❌ Sua bolsa não possui **${moneyFormatter.format(amount)} moedas**.`,
                });
            }

            console.error('Erro no comando /pagar:', error);
            return interaction.editReply({
                content: '❌ O banco da guilda não conseguiu concluir a transferência.',
            });
        }
    },

    createReceiptEmbed,
    transferCoins,
};
