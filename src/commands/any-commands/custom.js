const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const Profile = require('../../models/profile');
const { getProfile } = require('../../utils/profileManager');

const DEFAULT_COLOR = '#8B1E2D';
const DEFAULT_CREST = '⚔️';
const LEGACY_DEFAULT_COLOR = '#00FF00';

const COLOR_OPTIONS = [
    { name: 'Esmeralda', value: '#2F6B4F', emoji: '🟢' },
    { name: 'Safira', value: '#345995', emoji: '🔵' },
    { name: 'Dourado', value: '#C9A227', emoji: '🟡' },
    { name: 'Rubi', value: '#8B1E2D', emoji: '🔴' },
    { name: 'Ametista', value: '#6A3D7C', emoji: '🟣' },
    { name: 'Ônix', value: '#2B2D31', emoji: '⚫' },
    { name: 'Gelo', value: '#4B8B9B', emoji: '❄️' },
    { name: 'Bronze', value: '#9C6B30', emoji: '🟤' },
];

const CREST_OPTIONS = [
    { name: 'Espadas', value: '⚔️', description: 'Brasão de um guerreiro' },
    { name: 'Escudo', value: '🛡️', description: 'Brasão de um guardião' },
    { name: 'Dragão', value: '🐉', description: 'Brasão de uma lenda' },
    { name: 'Mago', value: '🧙', description: 'Brasão de um arcano' },
    { name: 'Arqueiro', value: '🏹', description: 'Brasão de um caçador' },
    { name: 'Coroa', value: '👑', description: 'Brasão da realeza' },
    { name: 'Dados', value: '🎲', description: 'Brasão da fortuna' },
    { name: 'Bardo', value: '🪕', description: 'Brasão dos trovadores' },
];

function cleanInput(value, maxLength) {
    return Array.from(String(value ?? ''))
        .filter((character) => {
            const code = character.codePointAt(0);
            return code > 31 && code !== 127;
        })
        .join('')
        .trim()
        .slice(0, maxLength);
}

function displayText(value, maxLength, fallback) {
    const clean = cleanInput(value, maxLength);
    if (!clean) return fallback;
    return clean
        .replace(/([\\`*_~|>])/g, '\\$1')
        .replace(/@/g, '＠');
}

function ensureCustomizations(profile) {
    if (!profile.customizations) profile.customizations = {};
    const { customizations } = profile;

    if (!/^#[0-9a-f]{6}$/i.test(String(customizations.color || ''))
        || String(customizations.color).toUpperCase() === LEGACY_DEFAULT_COLOR) {
        customizations.color = DEFAULT_COLOR;
    }
    customizations.title = cleanInput(customizations.title, 30);
    customizations.motto = cleanInput(customizations.motto, 80);
    customizations.crest = cleanInput(customizations.crest, 8) || DEFAULT_CREST;

    return customizations;
}

function findColorName(color) {
    return COLOR_OPTIONS.find((option) => option.value.toLowerCase() === String(color).toLowerCase())?.name
        || 'Personalizada';
}

function createMainMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('profile_custom')
            .setPlaceholder('Escolha o que deseja forjar')
            .addOptions(
                {
                    label: 'Tinta do estandarte',
                    value: 'color',
                    description: 'Escolha a cor principal da ficha',
                    emoji: '🎨',
                },
                {
                    label: 'Brasão',
                    value: 'crest',
                    description: 'Escolha o símbolo da sua linhagem',
                    emoji: '🛡️',
                },
                {
                    label: 'Epíteto',
                    value: 'title',
                    description: 'Escreva o título do aventureiro',
                    emoji: '📜',
                },
                {
                    label: 'Lema',
                    value: 'motto',
                    description: 'Registre sua frase nas crônicas',
                    emoji: '✒️',
                },
            ),
    );
}

function createBackRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('profile_back')
            .setLabel('Voltar à forja')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary),
    );
}

function renderMainMenu(profile, user, clientUser, notice = '') {
    const customizations = ensureCustomizations(profile);
    const displayName = displayText(user.displayName || user.globalName || user.username, 80, 'Aventureiro');
    const title = displayText(customizations.title, 30, 'Aventureiro sem epíteto');
    const motto = displayText(customizations.motto, 80, 'Nenhum lema foi gravado ainda.');
    const intro = notice ? `${notice}\n\n` : '';

    const embed = new EmbedBuilder()
        .setColor(customizations.color)
        .setAuthor({
            name: '⚒️ FORJA DE IDENTIDADES • GIDEON',
            iconURL: clientUser?.displayAvatarURL?.(),
        })
        .setTitle(`${customizations.crest} Estandarte de ${displayName}`)
        .setThumbnail(user.displayAvatarURL?.({ size: 256 }) || null)
        .setDescription(`${intro}> Escolha abaixo o detalhe que deseja alterar. A prévia desta ficha muda assim que a escolha for salva.`)
        .addFields(
            {
                name: '📜 Epíteto atual',
                value: `**${title}**`,
                inline: true,
            },
            {
                name: '🎨 Tinta atual',
                value: `**${findColorName(customizations.color)}**\n\`${customizations.color.toUpperCase()}\``,
                inline: true,
            },
            {
                name: '✒️ Lema das crônicas',
                value: `“${motto}”`,
                inline: false,
            },
        )
        .setFooter({ text: 'As alterações aparecem imediatamente no comando /perfil' });

    return { embeds: [embed], components: [createMainMenu()] };
}

function renderColorMenu(profile) {
    const customizations = ensureCustomizations(profile);
    const menu = new StringSelectMenuBuilder()
        .setCustomId('profile_color')
        .setPlaceholder('Escolha a tinta do estandarte')
        .addOptions(COLOR_OPTIONS.map((option) => ({
            label: option.name,
            value: option.value,
            description: option.value,
            emoji: option.emoji,
            default: option.value.toLowerCase() === customizations.color.toLowerCase(),
        })));

    return {
        embeds: [
            new EmbedBuilder()
                .setColor(customizations.color)
                .setTitle('🎨 Tintas do Estandarte')
                .setDescription('Selecione uma tonalidade medieval para iluminar sua ficha.'),
        ],
        components: [new ActionRowBuilder().addComponents(menu), createBackRow()],
    };
}

function renderCrestMenu(profile) {
    const customizations = ensureCustomizations(profile);
    const menu = new StringSelectMenuBuilder()
        .setCustomId('profile_crest')
        .setPlaceholder('Escolha o brasão da sua linhagem')
        .addOptions(CREST_OPTIONS.map((option) => ({
            label: option.name,
            value: option.value,
            description: option.description,
            emoji: option.value,
            default: option.value === customizations.crest,
        })));

    return {
        embeds: [
            new EmbedBuilder()
                .setColor(customizations.color)
                .setTitle('🛡️ Salão dos Brasões')
                .setDescription('Escolha o símbolo que aparecerá ao lado do seu nome.'),
        ],
        components: [new ActionRowBuilder().addComponents(menu), createBackRow()],
    };
}

function createTextModal(kind, interactionId, currentValue) {
    const isTitle = kind === 'title';
    const modalId = `profile_${kind}_${interactionId}`;
    const inputId = `profile_${kind}_input`;
    const input = new TextInputBuilder()
        .setCustomId(inputId)
        .setLabel(isTitle ? 'Epíteto do aventureiro' : 'Lema do aventureiro')
        .setStyle(isTitle ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setPlaceholder(isTitle ? 'Ex.: Guardião da Lua Rubra' : 'Ex.: Nenhuma estrada vence quem não para.')
        .setMaxLength(isTitle ? 30 : 80)
        .setRequired(false);

    if (currentValue) input.setValue(currentValue);

    return {
        modalId,
        inputId,
        modal: new ModalBuilder()
            .setCustomId(modalId)
            .setTitle(isTitle ? 'Gravar epíteto' : 'Gravar lema')
            .addComponents(new ActionRowBuilder().addComponents(input)),
    };
}

async function saveProfileAppearance(profile) {
    profile.markModified?.('customizations');
    await profile.save();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('customizar')
        .setDescription('Personalize sua ficha de aventureiro.')
        .setDMPermission(false),

    async execute(interaction) {
        const userId = interaction.user.id;
        const { guildId } = interaction;
        let collector;

        try {
            let profile = await getProfile(guildId, userId);
            if (!profile) {
                profile = await Profile.findOneAndUpdate(
                    { guildId, userId },
                    {
                        $set: { username: interaction.user.username },
                        $setOnInsert: { guildId, userId },
                    },
                    { new: true, upsert: true, setDefaultsOnInsert: true },
                );
            }

            ensureCustomizations(profile);
            await interaction.reply({
                ...renderMainMenu(profile, interaction.user, interaction.client.user),
                flags: 64,
            });

            const replyMessage = await interaction.fetchReply();
            collector = replyMessage.createMessageComponentCollector({
                filter: (componentInteraction) => componentInteraction.user.id === userId,
                time: 300_000,
            });

            collector.on('collect', async (componentInteraction) => {
                try {
                    if (componentInteraction.customId === 'profile_custom') {
                        const choice = componentInteraction.values[0];

                        if (choice === 'color') {
                            await componentInteraction.update(renderColorMenu(profile));
                            return;
                        }

                        if (choice === 'crest') {
                            await componentInteraction.update(renderCrestMenu(profile));
                            return;
                        }

                        const customizations = ensureCustomizations(profile);
                        const textModal = createTextModal(choice, interaction.id, customizations[choice]);
                        await componentInteraction.showModal(textModal.modal);

                        const modalInteraction = await componentInteraction.awaitModalSubmit({
                            filter: (submission) => submission.customId === textModal.modalId
                                && submission.user.id === userId,
                            time: 60_000,
                        });
                        const maxLength = choice === 'title' ? 30 : 80;
                        customizations[choice] = cleanInput(
                            modalInteraction.fields.getTextInputValue(textModal.inputId),
                            maxLength,
                        );
                        await saveProfileAppearance(profile);

                        const label = choice === 'title' ? 'Epíteto' : 'Lema';
                        const notice = customizations[choice]
                            ? `✅ **${label} gravado nas crônicas.**`
                            : `✅ **${label} removido da ficha.**`;
                        await modalInteraction.update(
                            renderMainMenu(profile, interaction.user, interaction.client.user, notice),
                        );
                        return;
                    }

                    if (componentInteraction.customId === 'profile_back') {
                        await componentInteraction.update(
                            renderMainMenu(profile, interaction.user, interaction.client.user),
                        );
                        return;
                    }

                    if (componentInteraction.customId === 'profile_color') {
                        const selectedColor = componentInteraction.values[0];
                        const option = COLOR_OPTIONS.find((item) => item.value === selectedColor);
                        if (!option) {
                            await componentInteraction.deferUpdate();
                            return;
                        }

                        ensureCustomizations(profile).color = option.value;
                        await saveProfileAppearance(profile);
                        await componentInteraction.update(renderMainMenu(
                            profile,
                            interaction.user,
                            interaction.client.user,
                            `✅ **Estandarte tingido de ${option.name}.**`,
                        ));
                        return;
                    }

                    if (componentInteraction.customId === 'profile_crest') {
                        const selectedCrest = componentInteraction.values[0];
                        const option = CREST_OPTIONS.find((item) => item.value === selectedCrest);
                        if (!option) {
                            await componentInteraction.deferUpdate();
                            return;
                        }

                        ensureCustomizations(profile).crest = option.value;
                        await saveProfileAppearance(profile);
                        await componentInteraction.update(renderMainMenu(
                            profile,
                            interaction.user,
                            interaction.client.user,
                            `✅ **Brasão de ${option.name} equipado.**`,
                        ));
                    }
                } catch (error) {
                    if (error.code !== 'InteractionCollectorError') {
                        console.error('Erro em componente de customização:', error);
                    }
                }
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => {});
            });
        } catch (error) {
            collector?.stop();
            console.error('Erro no comando /customizar:', error);
            const response = { content: '❌ Não consegui abrir a forja de identidades.' };

            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ ...response, flags: 64 }).catch(() => {});
            }
            return interaction.reply({ ...response, flags: 64 }).catch(() => {});
        }

        return undefined;
    },

    COLOR_OPTIONS,
    CREST_OPTIONS,
    cleanInput,
    createTextModal,
    ensureCustomizations,
    renderColorMenu,
    renderCrestMenu,
    renderMainMenu,
};
