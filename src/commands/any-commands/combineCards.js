const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const Profile = require('../../models/profile');
const {
    RARITY_COLORS,
    addCardInstance,
    combineCards,
    createCardInstance,
    formatFloat,
    getCard,
    getCardArtwork,
    getCardInstances,
    getCardState,
    getCardValue,
    isCardMarried,
    migrateLegacyCardInstances,
    removeCardInstances,
    resolveCardInstance,
} = require('../../utils/cardCatalog');
const { getProfile, withProfileLock } = require('../../utils/profileManager');

const COPIES_REQUIRED = 2;

async function combineDuplicates(
    guildId,
    userId,
    firstIdentifier,
    secondIdentifier,
    ProfileModel = Profile,
) {
    return withProfileLock(guildId, userId, async () => {
        const currentProfile = await ProfileModel.findOne({ guildId, userId });
        if (!currentProfile) return { status: 'insufficient' };
        migrateLegacyCardInstances(currentProfile);
        const firstInstance = resolveCardInstance(currentProfile, firstIdentifier);
        const fallbackCardId = firstInstance?.cardId || getCard(firstIdentifier)?.id;
        const secondInstance = secondIdentifier
            ? resolveCardInstance(currentProfile, secondIdentifier)
            : getCardInstances(currentProfile, fallbackCardId)
                .find((instance) => instance.uid !== firstInstance?.uid);
        if (!firstInstance || !secondInstance) return { status: 'insufficient' };
        if (firstInstance.uid === secondInstance.uid
            || firstInstance.cardId !== secondInstance.cardId) {
            return { status: 'mismatch' };
        }

        const sourceCard = getCard(firstInstance.cardId);
        if (!sourceCard) return { status: 'invalid' };
        if (isCardMarried(currentProfile, firstInstance.uid)
            || isCardMarried(currentProfile, secondInstance.uid)) {
            return { status: 'protected', sourceCard };
        }

        let combination;
        if (sourceCard.rarity === 'Mítico') {
            combination = {
                card: sourceCard,
                upgraded: false,
                chance: 0,
                mythicalReroll: true,
            };
        } else {
            try {
                combination = combineCards(sourceCard);
            } catch {
                return { status: 'maximum', sourceCard };
            }
        }

        const consumedInstances = [firstInstance, secondInstance];
        removeCardInstances(currentProfile, consumedInstances.map((instance) => instance.uid));
        const resultInstance = createCardInstance(combination.card);
        addCardInstance(currentProfile, resultInstance);
        await currentProfile.save();
        return {
            status: 'combined',
            sourceCard,
            resultCard: combination.card,
            resultInstance,
            consumedInstances,
            upgraded: combination.upgraded,
            chance: combination.chance,
            mythicalReroll: combination.mythicalReroll || false,
            profile: currentProfile,
        };
    });
}

async function getCombineAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const search = String(focused.value).toLowerCase();
    const profile = await getProfile(interaction.guildId, interaction.user.id);
    const available = getCardInstances(profile)
        .filter((instance) => !isCardMarried(profile, instance.uid));
    let candidates;

    if (focused.name === 'segunda') {
        const firstIdentifier = interaction.options.getString('primeira');
        const firstInstance = resolveCardInstance(profile, firstIdentifier);
        candidates = firstInstance
            ? available.filter((instance) => (
                instance.cardId === firstInstance.cardId && instance.uid !== firstInstance.uid
            ))
            : [];
    } else {
        const quantities = new Map();
        available.forEach((instance) => {
            quantities.set(instance.cardId, (quantities.get(instance.cardId) || 0) + 1);
        });
        candidates = available.filter((instance) => quantities.get(instance.cardId) >= COPIES_REQUIRED);
    }

    return candidates
        .map((instance) => ({ instance, card: getCard(instance.cardId) }))
        .filter(({ card, instance }) => card
            && `${card.name} ${card.rarity} ${instance.uid}`.toLowerCase().includes(search))
        .sort((left, right) => Number(left.instance.float) - Number(right.instance.float))
        .slice(0, 25)
        .map(({ card, instance }) => ({
            name: [
                `${card.emoji} ${card.name}`,
                card.rarity,
                `F ${formatFloat(instance.float)}`,
                getCardState(instance.float).name,
                `${getCardValue(card, instance.float).toLocaleString('pt-BR')}🪙`,
            ].join(' • ').slice(0, 100),
            value: instance.uid,
        }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combinar')
        .setDescription('Escolha duas cópias e tente elevar a raridade ou rerrolar o Float.')
        .addStringOption((option) => option
            .setName('primeira')
            .setDescription('Primeira cópia, ordenada pelo menor Float.')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption((option) => option
            .setName('segunda')
            .setDescription('Segunda cópia da mesma carta.')
            .setAutocomplete(true)
            .setRequired(true))
        .setDMPermission(false),

    async autocomplete(interaction) {
        await interaction.respond(await getCombineAutocomplete(interaction));
    },

    async execute(interaction) {
        await interaction.deferReply();
        const firstIdentifier = interaction.options.getString('primeira', true);
        const secondIdentifier = interaction.options.getString('segunda', true);
        const result = await combineDuplicates(
            interaction.guildId,
            interaction.user.id,
            firstIdentifier,
            secondIdentifier,
        );

        if (result.status === 'invalid') {
            return interaction.editReply({ content: '❌ Essa carta não existe no códice.' });
        }
        if (result.status === 'maximum') {
            return interaction.editReply({ content: '❌ Cartas míticas já atingiram a raridade máxima.' });
        }
        if (result.status === 'insufficient') {
            return interaction.editReply({
                content: '❌ Você precisa possuir pelo menos **duas cópias** dessa carta.',
            });
        }
        if (result.status === 'mismatch') {
            return interaction.editReply({
                content: '❌ Escolha duas cópias da **mesma carta**.',
            });
        }
        if (result.status === 'protected') {
            return interaction.editReply({
                content: '💍 Uma das cópias escolhidas está protegida por vínculo.',
            });
        }

        let outcome = '🜂 **Raridade mantida.**';
        if (result.upgraded) outcome = '✨ **Raridade elevada!**';
        if (result.mythicalReroll) outcome = '♻️ **Float mítico rerrolado.**';
        const condition = getCardState(result.resultInstance.float);
        const value = getCardValue(result.resultCard, result.resultInstance.float);
        const ownerName = interaction.user.displayName
            || interaction.user.globalName
            || interaction.user.username;
        const footer = { text: `Forjada por ${ownerName}` };
        const avatar = interaction.user.displayAvatarURL?.({ size: 64 });
        if (avatar) footer.iconURL = avatar;
        const embed = new EmbedBuilder()
            .setColor(RARITY_COLORS[result.resultCard.rarity])
            .setTitle(`${result.resultCard.emoji} ${result.resultCard.name}`)
            .setDescription([
                outcome,
                `⚒️ Origem · **${result.sourceCard.name} ×2**`,
                `🔬 Usados · **${result.consumedInstances.map(
                    (instance) => formatFloat(instance.float),
                ).join(' + ')}**`,
                `*${result.resultCard.type} • ${result.resultCard.rarity}*`,
                result.resultCard.circle ? `🔮 **${result.resultCard.circle}º círculo** · ${result.resultCard.school}` : '',
                result.resultCard.circle ? `📖 ${result.resultCard.tradition} · **${result.resultCard.manaCost} PM**` : '',
                `🔬 Float · **${formatFloat(result.resultInstance.float)}**`,
                `${condition.emoji} Estado · **${condition.name}**`,
                `🪙 Valor · **${value.toLocaleString('pt-BR')}**`,
                `🏷️ Série · \`${result.resultInstance.uid.slice(0, 8).toUpperCase()}\``,
                result.mythicalReroll
                    ? '🎲 Evolução · **Raridade máxima**'
                    : `🎲 Evolução · **${result.chance}%**`,
            ].filter(Boolean).join('\n'))
            .setFooter(footer);
        const artwork = getCardArtwork(result.resultCard);
        const files = [];
        if (artwork) {
            embed.setImage(artwork.url);
            files.push(new AttachmentBuilder(artwork.attachment, { name: artwork.name }));
        }

        return interaction.editReply({ embeds: [embed], files });
    },

    combineDuplicates,
    COPIES_REQUIRED,
    getCombineAutocomplete,
};
