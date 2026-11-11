const {
    AttachmentBuilder,
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const {
    buildCarouselControls,
    registerCarousel,
} = require('../../handlers/carouselInteractionHandler');
const {
    CARD_CATALOG,
    RARITIES,
    RARITY_COLORS,
    getCardArtwork,
    getCardValue,
    getCardsByRarity,
    getPackSpellChance,
    isSpellCard,
} = require('../../utils/cardCatalog');

const BASIC_RARITY_CHANCES = {
    Comum: 45,
    Incomum: 30,
    Raro: 16,
    Épico: 7,
    Lendário: 1.8,
    Mítico: 0.2,
};
const ARCANE_RARITY_CHANCES = {
    Comum: 0,
    Incomum: 0,
    Raro: 45,
    Épico: 30,
    Lendário: 21,
    Mítico: 4,
};
const GRIMOIRE_RARITY_CHANCES = {
    Comum: 35,
    Incomum: 25,
    Raro: 20,
    Épico: 12,
    Lendário: 6,
    Mítico: 2,
};
const CATEGORY_CHOICES = [
    ['Classes', 'Classe'],
    ['Raças', 'Raça'],
    ['Terrenos', 'Terreno'],
    ['Divindades de Arton', 'Divindade de Arton'],
    ['Divindades caídas', 'Divindade Caída'],
    ['Divindades esquecidas', 'Divindade Esquecida'],
    ['Deuses menores', 'Deus Menor'],
    ['Lendas de Arton', 'Lenda de Arton'],
    ['Magias de Arton', 'Magia de Arton'],
];
const moneyFormatter = new Intl.NumberFormat('pt-BR');
const percentFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
});

function getCatalogCards(category = null, rarity = null) {
    return CARD_CATALOG.filter((card) => (
        (!category || card.type === category)
        && (!rarity || card.rarity === rarity)
    ));
}

function formatCardChance(card, rarityChances, packType = 'basic') {
    const rarityChance = rarityChances[card.rarity] || 0;
    const spellChance = getPackSpellChance(packType, card.rarity);
    const categoryChance = isSpellCard(card) ? spellChance : 100 - spellChance;
    const cardsInKind = getCardsByRarity(card.rarity, packType)
        .filter((candidate) => isSpellCard(candidate) === isSpellCard(card));
    const categoriesInKind = new Set(cardsInKind.map((candidate) => candidate.type)).size;
    const cardsInCategory = cardsInKind
        .filter((candidate) => candidate.type === card.type)
        .length;
    if (
        rarityChance <= 0
        || categoryChance <= 0
        || categoriesInKind <= 0
        || cardsInCategory <= 0
    ) return '—';
    const categoryCardCount = categoriesInKind * cardsInCategory;
    const exactChance = (rarityChance * categoryChance) / (100 * categoryCardCount);
    return `${percentFormatter.format(exactChance)}%`;
}

function buildCodexSlide(card, position, total, filterLabel = 'Códice completo') {
    const minimumValue = getCardValue(card, 1);
    const maximumValue = getCardValue(card, 0);
    const embed = new EmbedBuilder()
        .setColor(RARITY_COLORS[card.rarity])
        .setAuthor({ name: '📜 CÓDICE DE GIDEON' })
        .setTitle(`${card.emoji} ${card.name}`)
        .setDescription([
            `*${card.type} • ${card.rarity}*`,
            card.circle ? `🔮 **${card.circle}º círculo** · ${card.school}` : '',
            card.circle ? `📖 ${card.tradition} · **${card.manaCost} PM**` : '',
            '',
            '🔬 Float · **Único**',
            `🪙 Valor · **${moneyFormatter.format(minimumValue)}–${moneyFormatter.format(maximumValue)}**`,
            `📦 Básico · **${formatCardChance(card, BASIC_RARITY_CHANCES, 'basic')}**`,
            `🔮 Arcano · **${formatCardChance(card, ARCANE_RARITY_CHANCES, 'arcane')}**`,
            `📕 Grimório · **${formatCardChance(card, GRIMOIRE_RARITY_CHANCES, 'grimoire')}**`,
        ].filter(Boolean).join('\n'))
        .setFooter({ text: `${position + 1}/${total} • ${filterLabel}` });
    const artwork = getCardArtwork(card);
    if (!artwork) return { embed, file: null };

    const attachmentName = `codice-${artwork.name}`;
    embed.setImage(`attachment://${attachmentName}`);
    return {
        embed,
        file: new AttachmentBuilder(artwork.attachment, { name: attachmentName }),
    };
}

function getFilterLabel(category, rarity) {
    if (category && rarity) return `${category} • ${rarity}`;
    return category || rarity || 'Códice completo';
}

function getSlidePayload(cards, position, filterLabel, replaceAttachment = false) {
    const slide = buildCodexSlide(cards[position], position, cards.length, filterLabel);
    const payload = {
        embeds: [slide.embed],
        components: cards.length > 1 ? [buildCarouselControls(position, cards.length)] : [],
        files: slide.file ? [slide.file] : [],
    };
    if (replaceAttachment) payload.attachments = [];
    return payload;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('codice')
        .setDescription('Consulte todas as cartas existentes no jogo.')
        .addStringOption((option) => option
            .setName('categoria')
            .setDescription('Mostra somente uma categoria de cartas.')
            .addChoices(...CATEGORY_CHOICES.map(([name, value]) => ({ name, value }))))
        .addStringOption((option) => option
            .setName('raridade')
            .setDescription('Mostra somente uma raridade.')
            .addChoices(...RARITIES.map((rarity) => ({ name: rarity, value: rarity }))))
        .setDMPermission(false),

    async execute(interaction) {
        const category = interaction.options.getString('categoria');
        const rarity = interaction.options.getString('raridade');
        const cards = getCatalogCards(category, rarity);

        if (!cards.length) {
            return interaction.reply({
                content: '📭 Nenhuma carta corresponde a esses filtros.',
                flags: 64,
            });
        }

        const filterLabel = getFilterLabel(category, rarity);
        await interaction.reply(getSlidePayload(cards, 0, filterLabel));
        if (cards.length === 1) return undefined;
        await registerCarousel(interaction, {
            total: cards.length,
            render: (nextPosition) => getSlidePayload(
                cards,
                nextPosition,
                filterLabel,
                true,
            ),
        });

        return undefined;
    },

    ARCANE_RARITY_CHANCES,
    BASIC_RARITY_CHANCES,
    GRIMOIRE_RARITY_CHANCES,
    buildCodexSlide,
    buildNavigation: buildCarouselControls,
    formatCardChance,
    getCatalogCards,
    getFilterLabel,
    getSlidePayload,
};
