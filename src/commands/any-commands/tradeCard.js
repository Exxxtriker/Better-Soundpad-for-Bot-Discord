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
    addCardInstance,
    formatFloat,
    getCard,
    getCardArtwork,
    getCardInstances,
    getCardState,
    getCardValue,
    getOwnedCards,
    isCardMarried,
    migrateLegacyCardInstances,
    removeCardInstances,
    resolveCardInstance,
} = require('../../utils/cardCatalog');
const { getProfile } = require('../../utils/profileManager');
const { guardComponentHandler } = require('../../utils/componentHandler');

function createTradeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

async function tradeCards(trade, dependencies = {}) {
    const ProfileModel = dependencies.ProfileModel || Profile;
    const connection = dependencies.connection || ProfileModel.db;
    const {
        guildId,
        senderId,
        recipientId,
        offeredInstanceId,
        requestedInstanceId,
        offeredCardId,
        requestedCardId,
    } = trade;

    if (senderId === recipientId) {
        throw createTradeError('INVALID_TRADE');
    }

    return connection.transaction(async (session) => {
        const currentSender = await ProfileModel.findOne({ guildId, userId: senderId })
            .session(session);
        const currentRecipient = await ProfileModel.findOne({ guildId, userId: recipientId })
            .session(session);
        if (!currentSender || !currentRecipient) throw createTradeError('REQUEST_UNAVAILABLE');
        migrateLegacyCardInstances(currentSender);
        migrateLegacyCardInstances(currentRecipient);

        const offeredInstance = resolveCardInstance(
            currentSender,
            offeredInstanceId || offeredCardId,
        );
        const requestedInstance = resolveCardInstance(
            currentRecipient,
            requestedInstanceId || requestedCardId,
        );
        if (!offeredInstance || isCardMarried(currentSender, offeredInstance.uid)) {
            throw createTradeError('OFFER_UNAVAILABLE');
        }
        if (!requestedInstance || isCardMarried(currentRecipient, requestedInstance.uid)) {
            throw createTradeError('REQUEST_UNAVAILABLE');
        }

        const offeredDescription = currentSender.cardDescriptions?.get?.(offeredInstance.uid) || '';
        const requestedDescription = currentRecipient.cardDescriptions?.get?.(requestedInstance.uid) || '';
        removeCardInstances(currentSender, [offeredInstance.uid]);
        removeCardInstances(currentRecipient, [requestedInstance.uid]);
        addCardInstance(currentSender, {
            uid: requestedInstance.uid,
            cardId: requestedInstance.cardId,
            float: requestedInstance.float,
            acquiredAt: requestedInstance.acquiredAt,
        });
        addCardInstance(currentRecipient, {
            uid: offeredInstance.uid,
            cardId: offeredInstance.cardId,
            float: offeredInstance.float,
            acquiredAt: offeredInstance.acquiredAt,
        });
        if (requestedDescription) {
            currentSender.cardDescriptions.set(requestedInstance.uid, requestedDescription);
        }
        if (offeredDescription) {
            currentRecipient.cardDescriptions.set(offeredInstance.uid, offeredDescription);
        }
        await currentSender.save({ session });
        await currentRecipient.save({ session });

        return {
            sender: currentSender, recipient: currentRecipient, offeredInstance, requestedInstance,
        };
    });
}

function formatTradeInstance(card, instance) {
    if (!instance) return `${card.emoji} **${card.name}**\n◆ ${card.rarity}`;
    const condition = getCardState(instance.float);
    const value = getCardValue(card, instance.float);
    return [
        `${card.emoji} **${card.name}**`,
        `*${card.type} • ${card.rarity}*`,
        card.circle ? `🔮 **${card.circle}º círculo** · ${card.school}` : '',
        card.circle ? `📖 ${card.tradition} · **${card.manaCost} PM**` : '',
        `🔬 Float · **${formatFloat(instance.float)}**`,
        `${condition.emoji} Estado · **${condition.name}**`,
        `🪙 Valor · **${value.toLocaleString('pt-BR')}**`,
        `🏷️ Série · \`${instance.uid.slice(0, 8).toUpperCase()}\``,
    ].filter(Boolean).join('\n');
}

function buildTradeEmbed(
    sender,
    recipient,
    offeredCard,
    requestedCard,
    status,
    offeredInstance = null,
    requestedInstance = null,
) {
    const descriptions = {
        pending: `${recipient} confirme a troca.`,
        accepted: '✅ **Troca concluída.**',
        rejected: '❌ **Troca recusada.**',
        expired: '⌛ **Troca expirada.**',
        failed: '⚠️ **Carta indisponível.**',
    };
    const footer = { text: `${sender.username} ↔ ${recipient.username}` };
    const avatar = sender.displayAvatarURL?.({ size: 64 });
    if (avatar) footer.iconURL = avatar;

    const embed = new EmbedBuilder()
        .setColor(status === 'accepted' ? 0x2F6B4F : 0x9C6B30)
        .setTitle('🤝 Troca de cartas')
        .setDescription(descriptions[status])
        .addFields(
            {
                name: `${sender.username} oferece`,
                value: formatTradeInstance(offeredCard, offeredInstance),
                inline: false,
            },
            {
                name: `${recipient.username} entrega`,
                value: formatTradeInstance(requestedCard, requestedInstance),
                inline: false,
            },
        )
        .setFooter(footer);

    const offeredArtwork = getCardArtwork(offeredCard);
    const requestedArtwork = getCardArtwork(requestedCard);
    if (offeredArtwork) embed.setImage(offeredArtwork.url);
    if (requestedArtwork) embed.setThumbnail(requestedArtwork.url);
    return embed;
}

function getTradeFiles(offeredCard, requestedCard) {
    const files = [getCardArtwork(offeredCard), getCardArtwork(requestedCard)]
        .filter((artwork, index, artworks) => (
            artwork && artworks.findIndex((candidate) => candidate?.name === artwork.name) === index
        ))
        .map((artwork) => new AttachmentBuilder(artwork.attachment, { name: artwork.name }));
    return files;
}

function createTradeButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tradecard_accept')
            .setLabel('Aceitar troca')
            .setEmoji('🤝')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('tradecard_reject')
            .setLabel('Recusar')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Danger),
    );
}

async function getAutocompleteCards(interaction) {
    const focused = interaction.options.getFocused(true);
    const target = interaction.options.getUser('jogador');
    const userId = focused.name === 'receber' ? target?.id : interaction.user.id;
    if (!userId) return [];

    const profile = await getProfile(interaction.guildId, userId);
    const search = String(focused.value).toLowerCase();
    return getOwnedCards(profile)
        .flatMap((card) => getCardInstances(profile, card.id).map((instance) => ({ card, instance })))
        .filter(({ card, instance }) => !isCardMarried(profile, instance.uid)
            && `${card.name} ${card.type} ${card.rarity} ${instance.uid}`.toLowerCase().includes(search))
        .slice(0, 25)
        .map(({ card, instance }) => {
            const state = getCardState(instance.float);
            return {
                name: `${card.emoji} ${card.name} • ${card.rarity} • F ${formatFloat(instance.float)} • ${state.name}`.slice(0, 100),
                value: instance.uid,
            };
        });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tradecard')
        .setDescription('Proponha uma troca de cartas a outro jogador.')
        .addUserOption((option) => option
            .setName('jogador')
            .setDescription('Jogador que receberá a proposta.')
            .setRequired(true))
        .addStringOption((option) => option
            .setName('oferecer')
            .setDescription('Carta da sua coleção que será oferecida.')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption((option) => option
            .setName('receber')
            .setDescription('Carta que deseja receber do outro jogador.')
            .setAutocomplete(true)
            .setRequired(true))
        .setDMPermission(false),

    async autocomplete(interaction) {
        await interaction.respond(await getAutocompleteCards(interaction));
    },

    async execute(interaction) {
        const recipient = interaction.options.getUser('jogador', true);
        const offeredInstanceId = interaction.options.getString('oferecer', true);
        const requestedInstanceId = interaction.options.getString('receber', true);

        if (recipient.bot || recipient.id === interaction.user.id) {
            return interaction.reply({
                content: '❌ Escolha outro jogador real para realizar a troca.',
                flags: 64,
            });
        }
        await interaction.deferReply();
        const [senderProfile, recipientProfile] = await Promise.all([
            getProfile(interaction.guildId, interaction.user.id),
            getProfile(interaction.guildId, recipient.id),
        ]);
        const offeredInstance = resolveCardInstance(senderProfile, offeredInstanceId);
        const requestedInstance = resolveCardInstance(recipientProfile, requestedInstanceId);
        const offeredCard = getCard(offeredInstance?.cardId);
        const requestedCard = getCard(requestedInstance?.cardId);
        if (!offeredCard || !requestedCard || !offeredInstance || !requestedInstance
            || isCardMarried(senderProfile, offeredInstance.uid)
            || isCardMarried(recipientProfile, requestedInstance.uid)) {
            return interaction.editReply({
                content: '❌ Uma das cartas selecionadas não está disponível para troca.',
            });
        }

        const pendingEmbed = buildTradeEmbed(
            interaction.user,
            recipient,
            offeredCard,
            requestedCard,
            'pending',
            offeredInstance,
            requestedInstance,
        );
        const message = await interaction.editReply({
            embeds: [pendingEmbed],
            components: [createTradeButtons()],
            files: getTradeFiles(offeredCard, requestedCard),
            allowedMentions: { users: [recipient.id] },
        });
        let settled = false;
        const collector = message.createMessageComponentCollector({ time: 120_000 });

        collector.on('collect', guardComponentHandler(async (componentInteraction) => {
            const isParticipant = [interaction.user.id, recipient.id].includes(componentInteraction.user.id);
            if (!isParticipant) {
                await componentInteraction.reply({
                    content: '❌ Esta proposta pertence a outros aventureiros.',
                    flags: 64,
                });
                return;
            }

            if (settled) {
                await componentInteraction.deferUpdate();
                return;
            }

            if (componentInteraction.customId === 'tradecard_reject') {
                settled = true;
                collector.stop('rejected');
                await componentInteraction.update({
                    embeds: [buildTradeEmbed(
                        interaction.user,
                        recipient,
                        offeredCard,
                        requestedCard,
                        'rejected',
                        offeredInstance,
                        requestedInstance,
                    )],
                    components: [],
                });
                return;
            }

            if (componentInteraction.user.id !== recipient.id) {
                await componentInteraction.reply({
                    content: '❌ Somente o destinatário pode aceitar esta troca.',
                    flags: 64,
                });
                return;
            }

            await componentInteraction.deferUpdate();
            if (settled) return;
            settled = true;
            let committed = false;
            try {
                await tradeCards({
                    guildId: interaction.guildId,
                    senderId: interaction.user.id,
                    recipientId: recipient.id,
                    offeredInstanceId: offeredInstance.uid,
                    requestedInstanceId: requestedInstance.uid,
                });
                committed = true;
                collector.stop('accepted');
                await interaction.editReply({
                    embeds: [buildTradeEmbed(
                        interaction.user,
                        recipient,
                        offeredCard,
                        requestedCard,
                        'accepted',
                        offeredInstance,
                        requestedInstance,
                    )],
                    components: [],
                });
            } catch (error) {
                if (committed) throw error;
                collector.stop('failed');
                if (!['OFFER_UNAVAILABLE', 'REQUEST_UNAVAILABLE'].includes(error.code)) {
                    console.error('Erro ao trocar cartas:', error);
                }
                await interaction.editReply({
                    embeds: [buildTradeEmbed(
                        interaction.user,
                        recipient,
                        offeredCard,
                        requestedCard,
                        'failed',
                        offeredInstance,
                        requestedInstance,
                    )],
                    components: [],
                });
            }
        }, 'Erro no painel de troca de cartas:'));

        collector.on('end', async (_, reason) => {
            if (settled || reason !== 'time') return;
            settled = true;
            await interaction.editReply({
                embeds: [buildTradeEmbed(
                    interaction.user,
                    recipient,
                    offeredCard,
                    requestedCard,
                    'expired',
                    offeredInstance,
                    requestedInstance,
                )],
                components: [],
            }).catch(() => {});
        });

        return undefined;
    },

    buildTradeEmbed,
    getAutocompleteCards,
    getTradeFiles,
    tradeCards,
};
