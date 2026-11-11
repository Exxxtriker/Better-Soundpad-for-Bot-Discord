const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getProfile } = require('../../utils/profileManager');
const {
    CARD_CATALOG,
    getCardTotal,
    getCollectionValue,
    getOwnedCards,
} = require('../../utils/cardCatalog');

const DEFAULT_PROFILE_COLOR = '#8B1E2D';
const DEFAULT_CREST = '⚔️';
const LEGACY_DEFAULT_COLOR = '#00FF00';
const numberFormatter = new Intl.NumberFormat('pt-BR');

function escapeDisplayText(value, maxLength, fallback = '') {
    const clean = Array.from(String(value ?? ''))
        .filter((character) => {
            const code = character.codePointAt(0);
            return code > 31 && code !== 127;
        })
        .join('')
        .trim()
        .slice(0, maxLength);

    if (!clean) return fallback;

    return clean
        .replace(/([\\`*_~|>])/g, '\\$1')
        .replace(/@/g, '＠');
}

function normalizeProfile(profile = {}) {
    const customizations = profile.customizations || {};
    const rawColor = String(customizations.color || '');

    return {
        level: Math.max(1, Number.parseInt(profile.level, 10) || 1),
        xp: Math.max(0, Number.parseInt(profile.xp, 10) || 0),
        points: Math.max(0, Number.parseInt(profile.points, 10) || 0),
        money: Math.max(0, Number.parseInt(profile.money, 10) || 0),
        emblems: Array.isArray(profile.emblems) ? profile.emblems : [],
        rewards: Array.isArray(profile.rewards) ? profile.rewards : [],
        customizations: {
            color: /^#[0-9a-f]{6}$/i.test(rawColor)
                && rawColor.toUpperCase() !== LEGACY_DEFAULT_COLOR
                ? rawColor
                : DEFAULT_PROFILE_COLOR,
            title: escapeDisplayText(customizations.title, 30),
            motto: escapeDisplayText(customizations.motto, 80),
            crest: escapeDisplayText(customizations.crest, 8, DEFAULT_CREST),
        },
    };
}

function getXPProgress(currentXP, level) {
    const requiredXP = Math.max(100, level * 100);
    const safeXP = Math.max(0, Number(currentXP) || 0);
    const percent = Math.min(100, Math.floor((safeXP / requiredXP) * 100));
    const barLength = 14;
    const filledLength = Math.round((barLength * percent) / 100);

    return {
        requiredXP,
        percent,
        bar: `${'▰'.repeat(filledLength)}${'▱'.repeat(barLength - filledLength)}`,
    };
}

function generateXPBar(currentXP, level) {
    const progress = getXPProgress(currentXP, level);
    return `${progress.bar}  **${progress.percent}%**\n\`${numberFormatter.format(currentXP)} / ${numberFormatter.format(progress.requiredXP)} XP\``;
}

function levelTitle(level) {
    if (level >= 90) return 'Soberano das Lendas';
    if (level >= 70) return 'Imperador Arcano';
    if (level >= 50) return 'Senhor da Guerra';
    if (level >= 35) return 'Campeão do Reino';
    if (level >= 20) return 'Cavaleiro Real';
    if (level >= 10) return 'Aventureiro Veterano';
    if (level >= 5) return 'Aprendiz da Guilda';
    return 'Viajante Novato';
}

function listItems(items, fallback, maxLength = 1024) {
    const text = items
        .map((item) => {
            const customEmojis = [];
            const protectedText = String(item ?? '').replace(
                /<a?:[a-z0-9_]{2,32}:\d{17,20}>/gi,
                (emoji) => {
                    const token = `\uE000${customEmojis.length}\uE001`;
                    customEmojis.push({ token, emoji });
                    return token;
                },
            );
            let formatted = escapeDisplayText(protectedText, 120);
            customEmojis.forEach(({ token, emoji }) => {
                formatted = formatted.replace(token, emoji);
            });
            return formatted;
        })
        .filter(Boolean)
        .join('  •  ');

    return (text || fallback).slice(0, maxLength);
}

function buildProfileEmbed(user, rawProfile, clientUser) {
    const profile = normalizeProfile(rawProfile);
    const cardTotal = getCardTotal(rawProfile);
    const uniqueCards = getOwnedCards(rawProfile).length;
    const collectionValue = getCollectionValue(rawProfile);
    const cardCapacity = Math.max(20, Number(rawProfile?.cardInventory?.capacity) || 20);
    const organizerLevel = Math.max(0, Number(rawProfile?.cardInventory?.organizerLevel) || 0);
    const basicPacks = Math.max(0, Number(rawProfile?.cardPacks?.basic) || 0);
    const arcanePacks = Math.max(0, Number(rawProfile?.cardPacks?.arcane) || 0);
    const grimoirePacks = Math.max(0, Number(rawProfile?.cardPacks?.grimoire) || 0);
    const rarityBoosters = Math.max(0, Number(rawProfile?.cardInventory?.rarityBoosters) || 0);
    const weddingRings = Math.max(0, Number(rawProfile?.cardInventory?.weddingRings) || 0);
    const descriptionScrolls = Math.max(0, Number(rawProfile?.cardInventory?.descriptionScrolls) || 0);
    const displayName = escapeDisplayText(
        user.displayName || user.globalName || user.username,
        80,
        'Aventureiro',
    );
    const rank = levelTitle(profile.level);
    const epithet = profile.customizations.title || rank;
    const motto = profile.customizations.motto || 'Minha história ainda está sendo escrita nas crônicas da guilda.';

    const embed = new EmbedBuilder()
        .setColor(profile.customizations.color)
        .setAuthor({
            name: '⚜️ GIDEON • REGISTRO DOS AVENTUREIROS',
            iconURL: clientUser?.displayAvatarURL?.(),
        })
        .setTitle(`${profile.customizations.crest} ${displayName} • Ficha de Aventureiro`)
        .setThumbnail(user.displayAvatarURL?.({ size: 256 }) || null)
        .setDescription(`**❖ ${epithet}**\n> “${motto}”`)
        .addFields(
            {
                name: '🏰 Patente',
                value: `**Nível ${profile.level}**\n${rank}`,
                inline: true,
            },
            {
                name: '🪙 Tesouro',
                value: `**${numberFormatter.format(profile.money)}** moedas`,
                inline: true,
            },
            {
                name: '✨ Renome',
                value: `**${numberFormatter.format(profile.points)}** pontos`,
                inline: true,
            },
            {
                name: `📈 Jornada até o nível ${profile.level + 1}`,
                value: generateXPBar(profile.xp, profile.level),
                inline: false,
            },
            {
                name: '📖 Descobertas',
                value: `**${uniqueCards}/${CARD_CATALOG.length}** cartas`,
                inline: true,
            },
            {
                name: '🃏 Cartas',
                value: `**${cardTotal}** no códice`,
                inline: true,
            },
            {
                name: '🪙 Coleção',
                value: `**${numberFormatter.format(collectionValue)}** moedas`,
                inline: true,
            },
            {
                name: '🎒 Espaços',
                value: `**${cardTotal}/${cardCapacity}** ocupados`,
                inline: true,
            },
            {
                name: '📦 Pacotes',
                value: `**${basicPacks}B / ${arcanePacks}A / ${grimoirePacks}G**`,
                inline: true,
            },
            {
                name: '🗂️ Organizador',
                value: `**Nível ${organizerLevel}/3**`,
                inline: true,
            },
            {
                name: '✨ Boosters',
                value: `**${rarityBoosters}** guardados`,
                inline: true,
            },
            {
                name: '💍 Anéis',
                value: `**${weddingRings}** guardados`,
                inline: true,
            },
            {
                name: '📝 Pergaminhos',
                value: `**${descriptionScrolls}** guardados`,
                inline: true,
            },
            {
                name: '🏵️ Brasões conquistados',
                value: listItems(profile.emblems, 'Nenhum brasão conquistado até agora.'),
                inline: false,
            },
        )
        .setFooter({
            text: 'Crônicas de Gideon • Use /customizar para forjar sua identidade',
            iconURL: clientUser?.displayAvatarURL?.(),
        })
        .setTimestamp();

    if (profile.rewards.length) {
        embed.addFields({
            name: '🎁 Relíquias e recompensas',
            value: listItems(profile.rewards, 'Nenhuma relíquia encontrada.'),
            inline: false,
        });
    }

    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription('Exibe sua ficha de aventureiro.')
        .setDMPermission(false),

    async execute(interaction) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply();
            }

            const profile = await getProfile(interaction.guildId, interaction.user.id);

            if (!profile) {
                await interaction.editReply({
                    content: '❌ Não consegui abrir sua ficha agora. Tente novamente em alguns instantes.',
                });
                return;
            }

            await interaction.editReply({
                embeds: [buildProfileEmbed(interaction.user, profile, interaction.client.user)],
            });
        } catch (error) {
            console.error('Erro ao exibir perfil:', error);
            const payload = { content: '❌ Ocorreu um erro ao abrir sua ficha de aventureiro.' };

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    },

    DEFAULT_PROFILE_COLOR,
    DEFAULT_CREST,
    buildProfileEmbed,
    escapeDisplayText,
    generateXPBar,
    getXPProgress,
    levelTitle,
    normalizeProfile,
};
