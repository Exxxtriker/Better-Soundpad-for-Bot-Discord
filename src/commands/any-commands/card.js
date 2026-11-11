const {
    AttachmentBuilder,
    EmbedBuilder,
    SlashCommandBuilder,
} = require('discord.js');
const Profile = require('../../models/profile');
const {
    formatFloat,
    getCard,
    getCardArtwork,
    getCardDescription,
    getCardInstances,
    getCardQuantity,
    getCardState,
    getCardValue,
    getOwnedCards,
    isCardMarried,
    migrateLegacyCardInstances,
    RARITY_COLORS,
    resolveCardInstance,
} = require('../../utils/cardCatalog');
const { getProfile, withProfileLock } = require('../../utils/profileManager');

const SORT_LEVELS = {
    rarity: 0,
    name: 1,
    type: 2,
    quantity: 3,
};

function cleanDescription(value) {
    return Array.from(String(value || ''))
        .filter((character) => character.codePointAt(0) > 31)
        .join('')
        .trim()
        .slice(0, 120);
}

function displayDescription(value) {
    return cleanDescription(value)
        .replace(/([\\`*_~|>])/g, '\\$1')
        .replace(/@/g, '＠');
}

function wrapCompactText(value, maximum = 30) {
    const words = String(value || '').split(/\s+/).filter(Boolean);
    const lines = [];
    for (const word of words) {
        const current = lines.at(-1);
        if (!current || `${current} ${word}`.length > maximum) lines.push(word);
        else lines[lines.length - 1] = `${current} ${word}`;
    }
    return lines.join('\n');
}

function createCardEmbed(user, profile, card, notice = '', requestedInstance = null) {
    const instance = requestedInstance || resolveCardInstance(profile, card.id);
    const quantity = getCardQuantity(profile, card.id);
    const married = instance ? isCardMarried(profile, instance.uid) : false;
    const customDescription = displayDescription(getCardDescription(
        profile,
        instance?.uid || card.id,
    ));
    const condition = instance ? getCardState(instance.float) : null;
    const estimatedValue = instance ? getCardValue(card, instance.float) : 0;
    const ownerName = user.displayName || user.globalName || user.username;
    const footer = {
        text: `Pertence a ${ownerName}`,
    };
    const avatar = user.displayAvatarURL?.({ size: 64 });
    if (avatar) footer.iconURL = avatar;
    const embed = new EmbedBuilder()
        .setColor(RARITY_COLORS[card.rarity])
        .setTitle(`${card.emoji} ${card.name}${married ? ' 💍' : ''}`)
        .setDescription([
            notice,
            `*${card.type} • ${card.rarity}*`,
            card.circle ? `🔮 **${card.circle}º círculo** · ${card.school}` : '',
            card.circle ? `📖 ${card.tradition} · **${card.manaCost} PM**` : '',
            `🔬 Float · **${instance ? formatFloat(instance.float) : '—'}**`,
            condition ? `${condition.emoji} Estado · **${condition.name}**` : '',
            `🪙 Valor · **${estimatedValue.toLocaleString('pt-BR')}**`,
            `🏷️ Série · \`${instance?.uid.slice(0, 8).toUpperCase() || '—'}\``,
            `🃏 Cópias · **${quantity}**`,
            `💍 Vínculo · ${married ? `**${ownerName}**` : 'Livre'}`,
            '',
            '**Descrição**',
            customDescription ? wrapCompactText(`“${customDescription}”`) : '*Nenhuma descrição.*',
        ].filter((line) => line !== '').join('\n'))
        .setFooter(footer);

    const artwork = getCardArtwork(card);
    const files = [];
    if (artwork) {
        embed.setImage(artwork.url);
        files.push(new AttachmentBuilder(artwork.attachment, { name: artwork.name }));
    }

    return { embeds: [embed], files };
}

async function describeCard(guildId, userId, identifier, description, ProfileModel = Profile) {
    const clean = cleanDescription(description);
    if (!clean) return { status: 'invalid_description' };

    return withProfileLock(guildId, userId, async () => {
        const profile = await ProfileModel.findOne({ guildId, userId });
        if (!profile) return { status: 'not_owned' };
        migrateLegacyCardInstances(profile);
        const instance = resolveCardInstance(profile, identifier);
        if (!instance) return { status: getCard(identifier) ? 'not_owned' : 'invalid' };
        const card = getCard(instance.cardId);
        if ((Number(profile.cardInventory?.descriptionScrolls) || 0) < 1) {
            return { status: 'no_scroll' };
        }

        profile.cardInventory.descriptionScrolls -= 1;
        profile.cardDescriptions.set(instance.uid, clean);
        await profile.save();
        return {
            status: 'described', profile, card, instance,
        };
    });
}

async function marryCard(guildId, userId, identifier, ProfileModel = Profile) {
    return withProfileLock(guildId, userId, async () => {
        const profile = await ProfileModel.findOne({ guildId, userId });
        if (!profile) return { status: 'not_owned' };
        migrateLegacyCardInstances(profile);
        const instance = resolveCardInstance(profile, identifier);
        if (!instance) return { status: getCard(identifier) ? 'not_owned' : 'invalid' };
        const card = getCard(instance.cardId);
        if (isCardMarried(profile, instance.uid)) return { status: 'already_married' };
        if ((Number(profile.cardInventory?.weddingRings) || 0) < 1) {
            return { status: 'no_ring' };
        }

        profile.cardInventory.weddingRings -= 1;
        profile.marriedCards.push(instance.uid);
        await profile.save();
        return {
            status: 'married', profile, card, instance,
        };
    });
}

async function organizeCards(guildId, userId, sortMode, ProfileModel = Profile) {
    const requiredLevel = SORT_LEVELS[sortMode];
    if (requiredLevel === undefined) return { status: 'invalid' };
    const profile = await ProfileModel.findOne({ guildId, userId });
    if (!profile) return { status: 'missing' };
    const organizerLevel = Number(profile?.cardInventory?.organizerLevel) || 0;
    if (organizerLevel < requiredLevel) {
        return { status: 'locked', requiredLevel };
    }

    profile.cardInventory.sortMode = sortMode;
    await profile.save();
    return { status: 'organized', profile };
}

async function autocompleteCards(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'carta') return [];
    const subcommand = interaction.options.getSubcommand();
    const target = subcommand === 'ver' ? interaction.options.getUser('jogador') : null;
    const userId = target?.id || interaction.user.id;
    const profile = await getProfile(interaction.guildId, userId);
    const search = String(focused.value).toLowerCase();

    return getOwnedCards(profile)
        .flatMap((card) => getCardInstances(profile, card.id).map((instance) => ({ card, instance })))
        .filter(({ card, instance }) => (
            `${card.name} ${card.type} ${card.rarity} ${instance.uid}`.toLowerCase().includes(search)
        ))
        .slice(0, 25)
        .map(({ card, instance }) => {
            const state = getCardState(instance.float);
            return {
                name: `${card.emoji} ${card.name} • ${card.rarity} • F ${formatFloat(instance.float)} • ${state.name}`.slice(0, 100),
                value: instance.uid,
            };
        });
}

function cardOption(option) {
    return option
        .setName('carta')
        .setDescription('Cópia única da coleção, identificada pelo Float.')
        .setAutocomplete(true)
        .setRequired(true);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('carta')
        .setDescription('Examine e personalize suas cartas.')
        .addSubcommand((subcommand) => subcommand
            .setName('ver')
            .setDescription('Exibe todos os detalhes de uma carta.')
            .addStringOption(cardOption)
            .addUserOption((option) => option
                .setName('jogador')
                .setDescription('Dono da coleção que deseja examinar.')))
        .addSubcommand((subcommand) => subcommand
            .setName('descrever')
            .setDescription('Altera a descrição de uma carta usando um pergaminho.')
            .addStringOption(cardOption)
            .addStringOption((option) => option
                .setName('descricao')
                .setDescription('Nova descrição pessoal da carta.')
                .setMaxLength(120)
                .setRequired(true)))
        .addSubcommand((subcommand) => subcommand
            .setName('casar')
            .setDescription('Use um anel para se casar com uma carta da coleção.')
            .addStringOption(cardOption))
        .addSubcommand((subcommand) => subcommand
            .setName('organizar')
            .setDescription('Escolha a organização padrão do seu álbum.')
            .addStringOption((option) => option
                .setName('ordem')
                .setDescription('Ordem desejada para o álbum.')
                .addChoices(
                    { name: 'Raridade • liberado', value: 'rarity' },
                    { name: 'Nome • organizador nível 1', value: 'name' },
                    { name: 'Categoria • organizador nível 2', value: 'type' },
                    { name: 'Quantidade • organizador nível 3', value: 'quantity' },
                )
                .setRequired(true)))
        .setDMPermission(false),

    async autocomplete(interaction) {
        await interaction.respond(await autocompleteCards(interaction));
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'organizar') {
            const sortMode = interaction.options.getString('ordem', true);
            const result = await organizeCards(interaction.guildId, interaction.user.id, sortMode);
            if (result.status === 'locked') {
                return interaction.reply({
                    content: `🗂️ Essa organização exige **Organizador nível ${result.requiredLevel}**. Visite o /mercador.`,
                    flags: 64,
                });
            }
            if (result.status !== 'organized') {
                return interaction.reply({
                    content: '📭 Abra um pacote para iniciar seu códice antes de organizá-lo.',
                    flags: 64,
                });
            }
            return interaction.reply({
                content: '✅ A nova organização foi aplicada ao seu `/cartas`.',
                flags: 64,
            });
        }

        const identifier = interaction.options.getString('carta', true);

        if (subcommand === 'ver') {
            const user = interaction.options.getUser('jogador') || interaction.user;
            const profile = await getProfile(interaction.guildId, user.id);
            const instance = resolveCardInstance(profile, identifier);
            const card = getCard(instance?.cardId || identifier);
            if (!card || !instance) {
                return interaction.reply({ content: '❌ Essa carta não está nessa coleção.', flags: 64 });
            }
            return interaction.reply(createCardEmbed(user, profile, card, '', instance));
        }

        if (subcommand === 'descrever') {
            const result = await describeCard(
                interaction.guildId,
                interaction.user.id,
                identifier,
                interaction.options.getString('descricao', true),
            );
            const errors = {
                not_owned: '❌ Essa carta não pertence à sua coleção.',
                no_scroll: '📝 Você precisa de um **Pergaminho de Descrição** do /mercador.',
                invalid_description: '❌ Escreva uma descrição válida.',
            };
            if (result.status !== 'described') {
                return interaction.reply({ content: errors[result.status] || '❌ Não foi possível alterar a carta.', flags: 64 });
            }
            return interaction.reply(createCardEmbed(
                interaction.user,
                result.profile,
                result.card,
                '📝 Descrição atualizada.',
                result.instance,
            ));
        }

        const result = await marryCard(interaction.guildId, interaction.user.id, identifier);
        const errors = {
            not_owned: '❌ Essa carta não pertence à sua coleção.',
            no_ring: '💍 Você precisa de um **Anel de Casamento** do /mercador.',
            already_married: '💍 Você já está casado(a) com essa carta.',
        };
        if (result.status !== 'married') {
            return interaction.reply({ content: errors[result.status] || '❌ Não foi possível realizar o casamento.', flags: 64 });
        }
        return interaction.reply(createCardEmbed(
            interaction.user,
            result.profile,
            result.card,
            '💍 Vínculo criado.',
            result.instance,
        ));
    },

    SORT_LEVELS,
    autocompleteCards,
    cleanDescription,
    createCardEmbed,
    describeCard,
    marryCard,
    organizeCards,
    wrapCompactText,
};
