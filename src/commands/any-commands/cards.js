const {
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const {
    buildCarouselControls,
    registerCarousel,
} = require('../../handlers/carouselInteractionHandler');
const { getProfile } = require('../../utils/profileManager');
const {
    RARITIES,
    getOwnedCards,
} = require('../../utils/cardCatalog');
const { createCardEmbed } = require('./card');

const ORDER_REQUIREMENTS = {
    rarity: 0,
    name: 1,
    type: 2,
    quantity: 3,
};

const ORDER_LABELS = {
    rarity: 'Raridade',
    name: 'Nome',
    type: 'Categoria',
    quantity: 'Quantidade',
};

function sortCards(cards, sortMode) {
    const rarityIndex = (card) => RARITIES.indexOf(card.rarity);
    return [...cards].sort((left, right) => {
        if (sortMode === 'name') return left.name.localeCompare(right.name, 'pt-BR');
        if (sortMode === 'type') {
            return left.type.localeCompare(right.type, 'pt-BR')
                || left.name.localeCompare(right.name, 'pt-BR');
        }
        if (sortMode === 'quantity') {
            return right.quantity - left.quantity
                || rarityIndex(right) - rarityIndex(left);
        }
        return rarityIndex(left) - rarityIndex(right)
            || left.name.localeCompare(right.name, 'pt-BR');
    });
}

function resolveSortMode(profile, requestedSortMode) {
    const organizer = Number(profile?.cardInventory?.organizerLevel) || 0;
    const savedSortMode = profile?.cardInventory?.sortMode || 'rarity';
    if (requestedSortMode && ORDER_REQUIREMENTS[requestedSortMode] <= organizer) {
        return requestedSortMode;
    }
    return ORDER_REQUIREMENTS[savedSortMode] <= organizer ? savedSortMode : 'rarity';
}

function buildCollectionEntries(profile, requestedSortMode) {
    const sortMode = resolveSortMode(profile, requestedSortMode);
    const cards = sortCards(getOwnedCards(profile), sortMode);
    const entries = cards.flatMap((card) => [...(card.instances || [])]
        .sort((left, right) => Number(left.float) - Number(right.float))
        .map((instance) => ({ card, instance })));
    return { entries, sortMode };
}

function buildCollectionSlide(user, profile, entry, index, total, sortMode) {
    const ownerName = user.displayName || user.globalName || user.username;
    const avatar = user.displayAvatarURL?.({ size: 64 });
    const payload = createCardEmbed(user, profile, entry.card, '', entry.instance);
    const slide = {
        embed: payload.embeds[0],
        file: payload.files?.[0] || null,
    };
    const footer = {
        text: `Pertence a ${ownerName} • ${ORDER_LABELS[sortMode]} • ${index + 1}/${total}`,
    };
    if (avatar) footer.iconURL = avatar;
    slide.embed.setFooter(footer);
    return slide;
}

function buildCollectionSlides(user, profile, requestedSortMode) {
    const { entries, sortMode } = buildCollectionEntries(profile, requestedSortMode);
    return entries.map((entry, index) => buildCollectionSlide(
        user,
        profile,
        entry,
        index,
        entries.length,
        sortMode,
    ));
}

function slidePayload(slide, position, total) {
    return {
        embeds: [slide.embed],
        components: total > 1 ? [buildCarouselControls(position, total)] : [],
        files: slide.file ? [slide.file] : [],
        attachments: [],
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cartas')
        .setDescription('Exibe todas as cartas da coleção de um aventureiro.')
        .addUserOption((option) => option
            .setName('jogador')
            .setDescription('Jogador cuja coleção deseja examinar.'))
        .addStringOption((option) => option
            .setName('ordem')
            .setDescription('Ordem do álbum, liberada pelos organizadores.')
            .addChoices(
                { name: 'Raridade', value: 'rarity' },
                { name: 'Nome', value: 'name' },
                { name: 'Categoria', value: 'type' },
                { name: 'Quantidade', value: 'quantity' },
            ))
        .setDMPermission(false),

    async execute(interaction) {
        const user = interaction.options.getUser('jogador') || interaction.user;
        const requestedSortMode = interaction.options.getString('ordem');
        const profile = await getProfile(interaction.guildId, user.id);

        if (!profile) {
            return interaction.reply({
                content: '📭 Esse aventureiro ainda não possui um álbum neste servidor.',
                flags: 64,
            });
        }

        const organizer = Number(profile.cardInventory?.organizerLevel) || 0;
        if (requestedSortMode && ORDER_REQUIREMENTS[requestedSortMode] > organizer) {
            return interaction.reply({
                content: `🗂️ Essa ordem exige **Organizador nível ${ORDER_REQUIREMENTS[requestedSortMode]}**. Compre melhorias no /mercador.`,
                flags: 64,
            });
        }

        const { entries, sortMode } = buildCollectionEntries(profile, requestedSortMode);
        if (!entries.length) {
            const ownerName = user.displayName || user.globalName || user.username;
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x7A1F2B)
                    .setTitle(`📭 Álbum de ${ownerName}`)
                    .setDescription('O códice está vazio. Use `/pack` para revelar sua primeira carta.')],
            });
        }

        const position = 0;
        const renderSlide = (nextPosition) => slidePayload(
            buildCollectionSlide(
                user,
                profile,
                entries[nextPosition],
                nextPosition,
                entries.length,
                sortMode,
            ),
            nextPosition,
            entries.length,
        );
        await interaction.reply(renderSlide(position));
        if (entries.length > 1) {
            await registerCarousel(interaction, {
                total: entries.length,
                render: renderSlide,
            });
        }

        return undefined;
    },

    buildCarouselControls,
    buildCollectionEntries,
    buildCollectionSlide,
    buildCollectionSlides,
    resolveSortMode,
    slidePayload,
    sortCards,
};
