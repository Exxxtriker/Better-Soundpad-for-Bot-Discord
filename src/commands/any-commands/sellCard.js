const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const Profile = require('../../models/profile');
const {
    formatFloat,
    getCard,
    getCardArtwork,
    getCardInstances,
    getCardState,
    getCardValue,
    getOwnedCards,
    isCardMarried,
    migrateLegacyCardInstances,
    RARITY_COLORS,
    removeCardInstances,
    resolveCardInstance,
} = require('../../utils/cardCatalog');
const { getProfile, withProfileLock } = require('../../utils/profileManager');
const { guardComponentHandler } = require('../../utils/componentHandler');

const moneyFormatter = new Intl.NumberFormat('pt-BR');
const SALE_CONFIRM_ID = 'sellcard_confirm';
const SALE_CANCEL_ID = 'sellcard_cancel';

function buildSaleControls(disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SALE_CONFIRM_ID)
            .setLabel('Vender carta')
            .setEmoji('🪙')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(SALE_CANCEL_ID)
            .setLabel('Cancelar')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
    );
}

function buildSalePreview(user, card, instance) {
    const state = getCardState(instance.float);
    const value = getCardValue(card, instance.float);
    const embed = new EmbedBuilder()
        .setColor(RARITY_COLORS[card.rarity])
        .setAuthor({ name: '⚜️ MERCADOR • PROPOSTA DE COMPRA' })
        .setTitle(`${card.emoji} ${card.name}`)
        .setDescription([
            `*${card.type} • ${card.rarity}*`,
            card.circle ? `🔮 **${card.circle}º círculo** · ${card.school}` : '',
            card.circle ? `📖 ${card.tradition} · **${card.manaCost} PM**` : '',
            `🔬 Float · **${formatFloat(instance.float)}**`,
            `${state.emoji} Estado · **${state.name}**`,
            `🏷️ Série · \`${instance.uid.slice(0, 8).toUpperCase()}\``,
            '',
            `🪙 Oferta · **${moneyFormatter.format(value)} moedas**`,
            '',
            '⚠️ Ao confirmar, esta cópia será removida permanentemente do seu álbum.',
        ].filter(Boolean).join('\n'))
        .setFooter({ text: `Oferta reservada para ${user.displayName || user.username}` });
    const artwork = getCardArtwork(card);
    if (!artwork) return { embed, files: [], value };

    embed.setImage(artwork.url);
    return {
        embed,
        files: [new AttachmentBuilder(artwork.attachment, { name: artwork.name })],
        value,
    };
}

function buildSaleResult(user, result) {
    const state = getCardState(result.instance.float);
    return new EmbedBuilder()
        .setColor(0xC9A227)
        .setAuthor({ name: '⚜️ MERCADOR • VENDA REGISTRADA' })
        .setTitle(`🪙 ${result.card.name} foi vendida`)
        .setDescription([
            `*${result.card.type} • ${result.card.rarity}*`,
            result.card.circle ? `🔮 **${result.card.circle}º círculo** · ${result.card.school}` : '',
            result.card.circle ? `📖 ${result.card.tradition} · **${result.card.manaCost} PM**` : '',
            `🔬 Float · **${formatFloat(result.instance.float)}**`,
            `${state.emoji} Estado · **${state.name}**`,
            `🏷️ Série · \`${result.instance.uid.slice(0, 8).toUpperCase()}\``,
            '',
            `💰 Recebido · **${moneyFormatter.format(result.value)} moedas**`,
            `🎒 Novo saldo · **${moneyFormatter.format(result.balance)} moedas**`,
        ].filter(Boolean).join('\n'))
        .setFooter({ text: `Venda concluída por ${user.displayName || user.username}` })
        .setTimestamp();
}

async function sellCard(guildId, userId, identifier, ProfileModel = Profile) {
    return withProfileLock(guildId, userId, async () => {
        const profile = await ProfileModel.findOne({ guildId, userId });
        if (!profile) return { status: 'missing' };

        migrateLegacyCardInstances(profile);
        const instance = resolveCardInstance(profile, identifier);
        if (!instance) return { status: 'unavailable' };
        if (isCardMarried(profile, instance.uid)) return { status: 'protected' };

        const card = getCard(instance.cardId);
        if (!card) return { status: 'unavailable' };
        const value = getCardValue(card, instance.float);

        removeCardInstances(profile, [instance.uid]);
        // O crédito e a remoção da carta pertencem à mesma gravação atômica.
        profile.$inc('money', value);
        await profile.save();
        const updatedBalance = await ProfileModel.findOne({ guildId, userId }, { money: 1 });

        return {
            status: 'sold',
            card,
            instance,
            value,
            balance: updatedBalance.money,
        };
    });
}

async function autocompleteCards(interaction) {
    const profile = await getProfile(interaction.guildId, interaction.user.id);
    const search = String(interaction.options.getFocused()).toLowerCase();

    return getOwnedCards(profile)
        .flatMap((card) => getCardInstances(profile, card.id)
            .map((instance) => ({ card, instance })))
        .filter(({ card, instance }) => !isCardMarried(profile, instance.uid)
            && `${card.name} ${card.type} ${card.rarity} ${instance.uid}`
                .toLowerCase().includes(search))
        .sort((left, right) => Number(left.instance.float) - Number(right.instance.float))
        .slice(0, 25)
        .map(({ card, instance }) => ({
            name: [
                `${card.emoji} ${card.name}`,
                card.rarity,
                `F ${formatFloat(instance.float)}`,
                getCardState(instance.float).name,
                `${moneyFormatter.format(getCardValue(card, instance.float))}🪙`,
            ].join(' • ').slice(0, 100),
            value: instance.uid,
        }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vendercarta')
        .setDescription('Venda uma cópia de carta ao mercador da guilda.')
        .addStringOption((option) => option
            .setName('carta')
            .setDescription('Cópia que deseja vender, identificada pelo Float e número de série.')
            .setAutocomplete(true)
            .setRequired(true))
        .setDMPermission(false),

    async autocomplete(interaction) {
        await interaction.respond(await autocompleteCards(interaction));
    },

    async execute(interaction) {
        await interaction.deferReply();
        const identifier = interaction.options.getString('carta', true);
        const profile = await getProfile(interaction.guildId, interaction.user.id);
        const instance = resolveCardInstance(profile, identifier);

        if (!instance) {
            return interaction.editReply({
                content: '❌ Essa cópia não está mais no seu álbum.',
            });
        }
        if (isCardMarried(profile, instance.uid)) {
            return interaction.editReply({
                content: '💍 Uma carta com vínculo não pode ser vendida.',
            });
        }

        const card = getCard(instance.cardId);
        if (!card) {
            return interaction.editReply({ content: '❌ Essa carta não existe no códice.' });
        }

        const preview = buildSalePreview(interaction.user, card, instance);
        await interaction.editReply({
            embeds: [preview.embed],
            components: [buildSaleControls()],
            files: preview.files,
        });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({ time: 60_000 });
        let finished = false;
        let processing = false;

        collector.on('collect', guardComponentHandler(async (componentInteraction) => {
            if (componentInteraction.user.id !== interaction.user.id) {
                await componentInteraction.reply({
                    content: '❌ Somente o dono da carta pode decidir esta venda.',
                    flags: 64,
                }).catch(() => {});
                return;
            }

            if (finished || processing) {
                await componentInteraction.deferUpdate();
                return;
            }

            if (componentInteraction.customId === SALE_CANCEL_ID) {
                finished = true;
                collector.stop('cancelled');
                await componentInteraction.update({
                    embeds: [preview.embed.setFooter({ text: 'Venda cancelada; a carta continua no álbum.' })],
                    components: [buildSaleControls(true)],
                }).catch(() => {});
                return;
            }

            processing = true;
            let result;
            try {
                await componentInteraction.deferUpdate();
                result = await sellCard(
                    interaction.guildId,
                    interaction.user.id,
                    identifier,
                );
            } finally {
                processing = false;
            }
            finished = true;
            collector.stop(result.status);

            if (result.status === 'protected') {
                await componentInteraction.editReply({
                    content: '💍 A carta recebeu um vínculo e não pode mais ser vendida.',
                    embeds: [],
                    components: [],
                    attachments: [],
                });
                return;
            }
            if (result.status !== 'sold') {
                await componentInteraction.editReply({
                    content: '❌ Essa cópia não está mais disponível no seu álbum.',
                    embeds: [],
                    components: [],
                    attachments: [],
                });
                return;
            }

            await componentInteraction.editReply({
                content: null,
                embeds: [buildSaleResult(interaction.user, result)],
                components: [],
                attachments: [],
            });
        }, 'Erro no painel de venda de cartas:'));

        collector.on('end', async () => {
            if (finished) return;
            await interaction.editReply({
                components: [buildSaleControls(true)],
                embeds: [preview.embed.setFooter({ text: 'A oferta expirou; a carta continua no álbum.' })],
            }).catch(() => {});
        });

        return undefined;
    },

    autocompleteCards,
    buildSaleControls,
    buildSalePreview,
    buildSaleResult,
    sellCard,
};
