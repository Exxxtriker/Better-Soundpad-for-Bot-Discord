/* eslint-disable no-nested-ternary */
/* eslint-disable max-len */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const OWNER_ID = '1467356224487161876';
const MAX_EMOJI_BYTES = 512 * 1024;

function formatEmoji(emoji) {
    return `${emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`} = \`${emoji.name}\` (\`${emoji.id}\`)`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emoji')
        .setDescription('Gerencia emojis da aplicação.')
        .addSubcommand((sub) => sub.setName('listar')
            .setDescription('Lista todos os emojis da aplicação.'))
        .addSubcommand((sub) => sub.setName('enviar')
            .setDescription('Envia (cria) um emoji novo.')
            .addStringOption((opt) => opt.setName('nome')
                .setDescription('Nome do emoji')
                .setRequired(true))
            .addAttachmentOption((opt) => opt.setName('arquivo')
                .setDescription('Imagem do emoji (png, jpg, gif)')
                .setRequired(true)))
        .addSubcommand((sub) => sub.setName('apagar')
            .setDescription('Apaga um emoji pelo ID.')
            .addStringOption((opt) => opt.setName('id')
                .setDescription('ID do emoji')
                .setRequired(true))),

    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Apenas o dono do bot pode usar este comando.', flags: 64 });
        }

        await interaction.deferReply();

        const tokenFromEnv = process.env.TOKEN;
        if (!tokenFromEnv) return interaction.editReply('❌ BOT_TOKEN não definido.');
        const token = `Bot ${tokenFromEnv}`;

        let applicationId = process.env.APPLICATION_ID;
        if (!applicationId) {
            const { client } = interaction;
            if (!client.application?.id) await client.application?.fetch();
            applicationId = client.application?.id;
        }
        if (!applicationId) return interaction.editReply('❌ Application ID não encontrado.');

        const sub = interaction.options.getSubcommand();

        try {
            if (sub === 'listar') {
                const { data } = await axios.get(
                    `https://discord.com/api/v10/applications/${applicationId}/emojis`,
                    { headers: { Authorization: token } },
                );

                const emojis = data.items;
                if (!emojis?.length) return interaction.editReply('❌ Nenhum emoji encontrado.');

                const emojiList = emojis.map(formatEmoji).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle(`📜 Emojis (${emojis.length})`)
                    .setDescription(emojiList.slice(0, 4000)) // limite embed
                    .setColor('#00FFFF')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'enviar') {
                const nome = interaction.options.getString('nome');
                const arquivo = interaction.options.getAttachment('arquivo');

                if (!/^[A-Za-z0-9_]{2,32}$/.test(nome)) {
                    return interaction.editReply('❌ O nome deve ter de 2 a 32 caracteres: letras, números ou _.');
                }

                if (!arquivo.contentType?.startsWith('image/')) {
                    return interaction.editReply('❌ O arquivo precisa ser uma imagem (png, jpg, gif).');
                }

                if (arquivo.size > MAX_EMOJI_BYTES) {
                    return interaction.editReply('❌ A imagem deve ter no máximo 512 KB.');
                }

                const imageResponse = await axios.get(arquivo.url, {
                    responseType: 'arraybuffer',
                    timeout: 15_000,
                    maxContentLength: MAX_EMOJI_BYTES,
                    maxBodyLength: MAX_EMOJI_BYTES,
                });
                const { data: emoji } = await axios.post(
                    `https://discord.com/api/v10/applications/${applicationId}/emojis`,
                    {
                        name: nome,
                        image: `data:${arquivo.contentType};base64,${Buffer.from(imageResponse.data).toString('base64')}`,
                    },
                    { headers: { Authorization: token, 'Content-Type': 'application/json' } },
                );

                return interaction.editReply(`✅ Emoji criado: ${formatEmoji(emoji)}`);
            }

            if (sub === 'apagar') {
                const id = interaction.options.getString('id');

                await axios.delete(
                    `https://discord.com/api/v10/applications/${applicationId}/emojis/${id}`,
                    { headers: { Authorization: token } },
                );

                return interaction.editReply(`🗑️ Emoji com ID \`${id}\` foi apagado.`);
            }
        } catch (err) {
            console.error('Erro ao gerenciar emojis:', err.response?.data ?? err.message ?? err);
            return interaction.editReply(`❌ Erro: ${err.response?.data?.message ?? err.message}`);
        }
    },
};
