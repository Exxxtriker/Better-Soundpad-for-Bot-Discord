const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Calcula sem bloquear o event loop, mesmo quando há muitos arquivos.
async function getFolderSize(folderPath) {
    async function calculateSize(dir) {
        const files = await fs.promises.readdir(dir, { withFileTypes: true });
        const sizes = await Promise.all(files.map(async (file) => {
            const filePath = path.join(dir, file.name);

            if (file.isSymbolicLink()) return 0;
            if (file.isDirectory()) return calculateSize(filePath);
            if (file.isFile()) {
                const stats = await fs.promises.stat(filePath);
                return stats.size;
            }
            return 0;
        }));
        return sizes.reduce((total, size) => total + size, 0);
    }

    return calculateSize(folderPath);
}

// Função para formatar automaticamente o tamanho
function formatSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    } if (bytes < 1024 ** 2) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    } if (bytes < 1024 ** 3) {
        return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    }
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('audiosize')
        .setDescription('Mostra o tamanho total da pasta /audios')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        try {
            const folderPath = path.join(__dirname, 'audios');
            const sizeInBytes = await getFolderSize(folderPath);
            const formattedSize = formatSize(sizeInBytes);

            await interaction.editReply({
                content: `📂 A pasta **/audios** ocupa aproximadamente **${formattedSize}**`,
            });
        } catch (error) {
            console.error('Erro ao calcular o tamanho da pasta de áudios:', error);
            await interaction.editReply({
                content: '❌ Não foi possível calcular o tamanho da pasta de áudios.',
            });
        }
    },
    formatSize,
    getFolderSize,
};
