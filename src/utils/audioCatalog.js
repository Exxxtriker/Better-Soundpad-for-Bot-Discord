const CATEGORY_ALIASES = new Map([
    ['music', 'Músicas'],
    ['musica', 'Músicas'],
    ['musicas', 'Músicas'],
    ['soundtrack', 'Trilhas Sonoras'],
    ['trilha', 'Trilhas Sonoras'],
    ['trilhas', 'Trilhas Sonoras'],
    ['sfx', 'SoundEffects'],
    ['soundeffect', 'SoundEffects'],
    ['soundeffects', 'SoundEffects'],
    ['efeito', 'SoundEffects'],
    ['efeitos', 'SoundEffects'],
    ['meme', 'SoundEffects'],
    ['ambient', 'Ambientes'],
    ['ambience', 'Ambientes'],
    ['ambiente', 'Ambientes'],
    ['voice', 'Vozes'],
    ['voz', 'Vozes'],
    ['vozes', 'Vozes'],
]);

const CATEGORY_PRIORITY = [
    'Trilhas Sonoras',
    'Ambientes',
    'SoundEffects',
    'Músicas',
    'Vozes',
    'Outros',
];

function normalizeCategoryKey(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function formatCategoryName(value) {
    const clean = value.trim().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
    const alias = CATEGORY_ALIASES.get(normalizeCategoryKey(clean));
    if (alias) return alias;

    return clean.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 40);
}

function parseAudioName(audioName) {
    const cleanName = String(audioName ?? '').trim();
    const separatorIndex = cleanName.indexOf('-');

    if (separatorIndex <= 0 || separatorIndex > 30) {
        return { category: 'Outros', displayName: cleanName, audioName: cleanName };
    }

    const prefix = cleanName.slice(0, separatorIndex).trim();
    const displayName = cleanName.slice(separatorIndex + 1).trim();
    if (!prefix || !displayName || !/^[\p{L}\p{N}_ ]+$/u.test(prefix)) {
        return { category: 'Outros', displayName: cleanName, audioName: cleanName };
    }

    return {
        category: formatCategoryName(prefix),
        displayName,
        audioName: cleanName,
    };
}

function compareCategories(first, second) {
    const firstPriority = CATEGORY_PRIORITY.indexOf(first);
    const secondPriority = CATEGORY_PRIORITY.indexOf(second);
    const firstRank = firstPriority === -1 ? CATEGORY_PRIORITY.length - 1 : firstPriority;
    const secondRank = secondPriority === -1 ? CATEGORY_PRIORITY.length - 1 : secondPriority;

    if (firstRank !== secondRank) return firstRank - secondRank;
    if (first === 'Outros') return 1;
    if (second === 'Outros') return -1;
    return first.localeCompare(second, 'pt-BR');
}

function buildAudioCatalog(audioNames) {
    const catalog = new Map();

    audioNames.forEach((audioName) => {
        const entry = parseAudioName(audioName);
        if (!catalog.has(entry.category)) catalog.set(entry.category, []);
        catalog.get(entry.category).push(entry);
    });

    return new Map([...catalog.entries()]
        .sort(([first], [second]) => compareCategories(first, second))
        .map(([category, entries]) => [category, entries.sort((first, second) => (
            first.displayName.localeCompare(second.displayName, 'pt-BR')
        ))]));
}

function getCategoryEmoji(category) {
    const key = normalizeCategoryKey(category);
    if (key.includes('trilha')) return '🎼';
    if (key.includes('ambiente')) return '🌲';
    if (key.includes('efeito') || key.includes('soundeffect')) return '💥';
    if (key.includes('musica')) return '🎵';
    if (key.includes('voz')) return '🗣️';
    if (key === 'outros') return '📦';
    return '🎧';
}

module.exports = {
    buildAudioCatalog,
    formatCategoryName,
    getCategoryEmoji,
    parseAudioName,
};
