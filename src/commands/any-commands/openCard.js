const {
    AttachmentBuilder,
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const path = require('node:path');
const {
    buildCarouselControls,
    registerCarousel,
} = require('../../handlers/carouselInteractionHandler');
const { getDisplayAttachment } = require('../../utils/imageAttachmentCache');
const Profile = require('../../models/profile');
const {
    addCardInstance,
    createCardInstance,
    drawCard,
    formatFloat,
    getCardArtwork,
    getCardState,
    getCardTotal,
    getCardValue,
    migrateLegacyCardInstances,
    RARITY_COLORS,
} = require('../../utils/cardCatalog');
const { withProfileLock } = require('../../utils/profileManager');

const PACK_NAMES = {
    basic: 'Pacote Básico',
    arcane: 'Pacote Arcano',
    grimoire: 'Pacote de Grimório',
};
const COLLECTIBLE_CARDS_PER_PACK = 2;
const JOKER_ARTWORK = path.join(__dirname, '..', '..', 'assets', 'cards', 'joker_gideon.png');

async function openPack(guildId, userId, username, packType, ProfileModel = Profile) {
    return withProfileLock(guildId, userId, async () => {
        await ProfileModel.updateOne(
            { guildId, userId },
            {
                $set: { username },
                $setOnInsert: { guildId, userId },
            },
            { upsert: true, setDefaultsOnInsert: true },
        );

        const currentProfile = await ProfileModel.findOne({ guildId, userId });
        migrateLegacyCardInstances(currentProfile);
        const packCount = Number(currentProfile?.cardPacks?.[packType]) || 0;
        if (packCount < 1) return { status: 'empty' };

        const cardTotal = getCardTotal(currentProfile);
        const capacity = Number(currentProfile?.cardInventory?.capacity) || 20;
        if (cardTotal + COLLECTIBLE_CARDS_PER_PACK > capacity) {
            return {
                status: 'full', cardTotal, capacity, requiredSlots: COLLECTIBLE_CARDS_PER_PACK,
            };
        }

        const boosterUsed = (Number(currentProfile?.cardInventory?.rarityBoosters) || 0) > 0;
        const rewards = Array.from({ length: COLLECTIBLE_CARDS_PER_PACK }, (_, index) => {
            const boosted = boosterUsed && index === 0;
            const card = drawCard(packType, undefined, boosted ? 1 : 0);
            const instance = createCardInstance(card);
            addCardInstance(currentProfile, instance);
            return { card, instance, boosted };
        });
        currentProfile.cardPacks[packType] -= 1;
        if (boosterUsed) currentProfile.cardInventory.rarityBoosters -= 1;
        await currentProfile.save();

        return {
            status: 'opened',
            rewards,
            card: rewards[0].card,
            instance: rewards[0].instance,
            profile: currentProfile,
            boosterUsed,
        };
    });
}

function buildOwnerFooter(user, position) {
    const name = user?.displayName || user?.globalName || user?.username || 'Aventureiro';
    const footer = { text: `Pertence a ${name} • ${position}/3` };
    const avatar = user?.displayAvatarURL?.({ size: 64 });
    if (avatar) footer.iconURL = avatar;
    return footer;
}

function buildCollectibleReveal(reward, position, user = null) {
    const { card, instance, boosted } = reward;
    const condition = getCardState(instance.float);
    const value = getCardValue(card, instance.float);
    const embed = new EmbedBuilder()
        .setColor(RARITY_COLORS[card.rarity])
        .setTitle(`${card.emoji} ${card.name}`)
        .setDescription([
            `*${card.type} • ${card.rarity}*`,
            card.circle ? `🔮 **${card.circle}º círculo** · ${card.school}` : '',
            card.circle ? `📖 ${card.tradition} · **${card.manaCost} PM**` : '',
            `🔬 Float · **${formatFloat(instance.float)}**`,
            `${condition.emoji} Estado · **${condition.name}**`,
            `🪙 Valor · **${value.toLocaleString('pt-BR')}**`,
            `🏷️ Série · \`${instance.uid.slice(0, 8).toUpperCase()}\``,
            boosted ? '✨ Booster aplicado' : '',
        ].filter(Boolean).join('\n'))
        .setFooter(buildOwnerFooter(user, position));
    const artwork = getCardArtwork(card);
    if (!artwork) return { embed, file: null };

    const attachmentName = `revelacao-${position}-${artwork.name}`;
    embed.setImage(`attachment://${attachmentName}`);
    return {
        embed,
        file: new AttachmentBuilder(artwork.attachment, { name: attachmentName }),
    };
}

function buildJokerReveal(remaining, cardTotal, capacity, user = null) {
    const artwork = getDisplayAttachment(JOKER_ARTWORK, 'joker-gideon.jpg');
    const attachmentName = artwork.name;
    const embed = new EmbedBuilder()
        .setColor(0xC9A227)
        .setTitle('🃏 Coringa do Gideon')
        .setDescription([
            '*Carta cerimonial*',
            '**Não entra no inventário.**',
            '',
            `📦 Pacotes · **${remaining}**`,
            `🎒 Espaços · **${cardTotal}/${capacity}**`,
        ].join('\n'))
        .setImage(`attachment://${attachmentName}`)
        .setFooter(buildOwnerFooter(user, 3));
    return {
        embed,
        file: new AttachmentBuilder(artwork.attachment, { name: attachmentName }),
    };
}

function slidePayload(slide, position, locked = false) {
    return {
        embeds: [slide.embed],
        components: [buildCarouselControls(position, 3, locked)],
        files: slide.file ? [slide.file] : [],
        attachments: [],
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pack')
        .setDescription('Abra duas cartas colecionáveis e o Coringa do Gideon.')
        .addStringOption((option) => option
            .setName('pacote')
            .setDescription('Tipo de pacote que deseja abrir.')
            .addChoices(
                { name: '📦 Pacote Básico', value: 'basic' },
                { name: '🔮 Pacote Arcano', value: 'arcane' },
                { name: '📕 Pacote de Grimório', value: 'grimoire' },
            )
            .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply();
        const packType = interaction.options.getString('pacote', true);
        const result = await openPack(
            interaction.guildId,
            interaction.user.id,
            interaction.user.username,
            packType,
        );

        if (result.status === 'empty') {
            return interaction.editReply({
                content: `❌ Você não possui nenhum **${PACK_NAMES[packType]}**.`,
            });
        }
        if (result.status === 'full') {
            return interaction.editReply({
                content: [
                    `🎒 Você precisa de **${result.requiredSlots} espaços livres** para abrir o pacote`,
                    `(**${result.cardTotal}/${result.capacity}**).`,
                    'Compre uma **Bolsa de Cartas** no /mercador.',
                ].join(' '),
            });
        }

        const remaining = result.profile.cardPacks?.[packType] || 0;
        const cardTotal = getCardTotal(result.profile);
        const capacity = Number(result.profile.cardInventory?.capacity) || 20;
        const collectibleReveals = result.rewards.map(
            (reward, index) => buildCollectibleReveal(reward, index + 1, interaction.user),
        );
        const jokerReveal = buildJokerReveal(
            remaining,
            cardTotal,
            capacity,
            interaction.user,
        );
        const slides = [...collectibleReveals, jokerReveal];
        const position = 0;
        await interaction.editReply(slidePayload(slides[position], position));
        await registerCarousel(interaction, {
            total: slides.length,
            render: (nextPosition) => slidePayload(slides[nextPosition], nextPosition),
        });

        return undefined;
    },

    openPack,
    buildCollectibleReveal,
    buildCarouselControls,
    buildJokerReveal,
    slidePayload,
};
