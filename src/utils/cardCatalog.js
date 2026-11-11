const { randomInt, randomUUID } = require('node:crypto');
const path = require('node:path');
const { getDisplayAttachment } = require('./imageAttachmentCache');

const RARITIES = ['Comum', 'Incomum', 'Raro', 'Épico', 'Lendário', 'Mítico'];
const RARITY_COLORS = {
    Comum: 0x8B8D91,
    Incomum: 0x2F6B4F,
    Raro: 0x345995,
    Épico: 0x6A3D7C,
    Lendário: 0xC9A227,
    Mítico: 0xB326C9,
};
const COMBINE_CHANCES = {
    Comum: 60,
    Incomum: 50,
    Raro: 40,
    Épico: 25,
    Lendário: 10,
    Mítico: 0,
};
const CARD_BASE_VALUES = {
    Comum: 100,
    Incomum: 250,
    Raro: 750,
    Épico: 2_500,
    Lendário: 9_000,
    Mítico: 35_000,
};
const FLOAT_CONDITIONS = [
    { maximum: 0.07, name: 'Nova de Fábrica', emoji: '💎' },
    { maximum: 0.15, name: 'Pouco Usada', emoji: '✨' },
    { maximum: 0.38, name: 'Testada em Campo', emoji: '🛡️' },
    { maximum: 0.45, name: 'Bem Desgastada', emoji: '⚒️' },
    { maximum: 1.000001, name: 'Marcada por Batalhas', emoji: '🩸' },
];
const FLOAT_PRECISION = 1_000_000;
const SPELL_CARD_TYPE = 'Magia de Arton';
const SPELL_MANA_COSTS = [0, 1, 3, 6, 10, 15];
const PACK_SPELL_CHANCES = {
    basic: {
        Comum: 12,
        Incomum: 14,
        Raro: 18,
        Épico: 23,
        Lendário: 30,
        Mítico: 40,
    },
    arcane: {
        Comum: 0,
        Incomum: 0,
        Raro: 28,
        Épico: 38,
        Lendário: 45,
        Mítico: 55,
    },
    grimoire: {
        Comum: 100,
        Incomum: 100,
        Raro: 100,
        Épico: 100,
        Lendário: 100,
        Mítico: 100,
    },
};

function defineSpellCard(id, name, emoji, rarity, circle, school, tradition) {
    return {
        id,
        type: SPELL_CARD_TYPE,
        name,
        emoji,
        rarity,
        circle,
        school,
        tradition,
        manaCost: SPELL_MANA_COSTS[circle],
    };
}

const CARD_ARTWORK = {
    class_warrior: 'class_warrior.png',
    class_rogue: 'class_rogue.png',
    class_ranger: 'class_ranger.png',
    class_bard: 'class_bard.png',
    class_cleric: 'class_cleric.png',
    class_barbarian: 'class_barbarian.png',
    class_monk: 'class_monk.png',
    class_druid: 'class_druid.png',
    class_paladin: 'class_paladin.png',
    class_sorcerer: 'class_sorcerer.png',
    class_artificer: 'class_artificer.png',
    class_warlock: 'class_warlock.png',
    class_wizard: 'class_wizard.png',
    class_necromancer: 'class_necromancer.png',
    class_runeknight: 'class_runeknight.png',
    class_chronomancer: 'class_chronomancer.png',
    race_human: 'race_human.png',
    race_elf: 'race_elf.png',
    race_dwarf: 'race_dwarf.png',
    race_halfling: 'race_halfling.png',
    race_orc: 'race_orc.png',
    race_gnome: 'race_gnome.png',
    race_goblin: 'race_goblin.png',
    race_kobold: 'race_kobold.png',
    race_tiefling: 'race_tiefling.png',
    race_dragonborn: 'race_dragonborn.png',
    race_genasi: 'race_genasi.png',
    race_tabaxi: 'race_tabaxi.png',
    race_aasimar: 'race_aasimar.png',
    race_firbolg: 'race_firbolg.png',
    race_changeling: 'race_changeling.png',
    race_triton: 'race_triton.png',
    race_celestial: 'race_celestial.png',
    race_ancient_dragon: 'race_ancient_dragon.png',
    terrain_ancient_forest: 'terrain_ancient_forest.png',
    terrain_golden_plains: 'terrain_golden_plains.png',
    terrain_witch_swamp: 'terrain_witch_swamp.png',
    terrain_scarlet_desert: 'terrain_scarlet_desert.png',
    terrain_lost_kingdom_ruins: 'terrain_lost_kingdom_ruins.png',
    terrain_underground_city: 'terrain_underground_city.png',
    terrain_floating_islands: 'terrain_floating_islands.png',
    terrain_dragon_valley: 'terrain_dragon_valley.png',
    terrain_infinite_library: 'terrain_infinite_library.png',
    terrain_worlds_end_throne: 'terrain_worlds_end_throne.png',
    terrain_astral_realm: 'terrain_astral_realm.png',
    terrain_world_heart: 'terrain_world_heart.png',
    tormenta_deity_aharadak: 'tormenta_deity_aharadak.png',
    tormenta_deity_allihanna: 'tormenta_deity_allihanna.png',
    tormenta_deity_arsenal: 'tormenta_deity_arsenal.png',
    tormenta_deity_azgher: 'tormenta_deity_azgher.png',
    tormenta_deity_hyninn: 'tormenta_deity_hyninn.png',
    tormenta_deity_kallyadranoch: 'tormenta_deity_kallyadranoch.png',
    tormenta_deity_khalmyr: 'tormenta_deity_khalmyr.png',
    tormenta_deity_lena: 'tormenta_deity_lena.png',
    tormenta_deity_lin_wu: 'tormenta_deity_lin_wu.png',
    tormenta_deity_marah: 'tormenta_deity_marah.png',
    tormenta_deity_megalokk: 'tormenta_deity_megalokk.png',
    tormenta_deity_nimb: 'tormenta_deity_nimb.png',
    tormenta_deity_oceano: 'tormenta_deity_oceano.png',
    tormenta_deity_sszzaas: 'tormenta_deity_sszzaas.png',
    tormenta_deity_tanna_toh: 'tormenta_deity_tanna_toh.png',
    tormenta_deity_tenebra: 'tormenta_deity_tenebra.png',
    tormenta_deity_thwor: 'tormenta_deity_thwor.png',
    tormenta_deity_thyatis: 'tormenta_deity_thyatis.png',
    tormenta_deity_valkaria: 'tormenta_deity_valkaria.png',
    tormenta_deity_wynna: 'tormenta_deity_wynna.png',
    tormenta_fallen_glorienn: 'tormenta_fallen_glorienn.png',
    tormenta_fallen_keenn: 'tormenta_fallen_keenn.png',
    tormenta_fallen_ragnar: 'tormenta_fallen_ragnar.png',
    tormenta_fallen_tauron: 'tormenta_fallen_tauron.png',
    tormenta_fallen_tillian: 'tormenta_fallen_tillian.png',
    tormenta_forgotten_divina_serpente: 'tormenta_forgotten_divina_serpente.png',
    tormenta_minor_sckhar: 'tormenta_minor_sckhar.png',
    tormenta_minor_beluhga: 'tormenta_minor_beluhga.png',
    tormenta_minor_benthos: 'tormenta_minor_benthos.png',
    tormenta_minor_rhond: 'tormenta_minor_rhond.png',
    tormenta_minor_hippion: 'tormenta_minor_hippion.png',
    tormenta_minor_tibar: 'tormenta_minor_tibar.png',
    tormenta_legend_lisandra: 'tormenta_legend_lisandra.png',
    tormenta_legend_sandro_galtran: 'tormenta_legend_sandro_galtran.png',
    tormenta_legend_niele: 'tormenta_legend_niele.png',
    tormenta_legend_tork: 'tormenta_legend_tork.png',
    tormenta_spell_curar_ferimentos: 'tormenta_spell_curar_ferimentos.png',
    tormenta_spell_seta_infalivel_de_talude: 'tormenta_spell_seta_infalivel_de_talude.png',
    tormenta_spell_armadura_arcana: 'tormenta_spell_armadura_arcana.png',
    tormenta_spell_conjurar_monstro: 'tormenta_spell_conjurar_monstro.png',
    tormenta_spell_sono: 'tormenta_spell_sono.png',
    tormenta_spell_bola_de_fogo: 'tormenta_spell_bola_de_fogo.png',
    tormenta_spell_dissipar_magia: 'tormenta_spell_dissipar_magia.png',
    tormenta_spell_relampago: 'tormenta_spell_relampago.png',
    tormenta_spell_velocidade: 'tormenta_spell_velocidade.png',
    tormenta_spell_oracao: 'tormenta_spell_oracao.png',
    tormenta_spell_teletransporte: 'tormenta_spell_teletransporte.png',
    tormenta_spell_voo: 'tormenta_spell_voo.png',
    tormenta_spell_servo_morto_vivo: 'tormenta_spell_servo_morto_vivo.png',
    tormenta_spell_transformacao_de_guerra: 'tormenta_spell_transformacao_de_guerra.png',
    tormenta_spell_enxame_rubro_de_ichabod: 'tormenta_spell_enxame_rubro_de_ichabod.png',
    tormenta_spell_desintegrar: 'tormenta_spell_desintegrar.png',
    tormenta_spell_campo_antimagia: 'tormenta_spell_campo_antimagia.png',
    tormenta_spell_guardiao_divino: 'tormenta_spell_guardiao_divino.png',
    tormenta_spell_terremoto: 'tormenta_spell_terremoto.png',
    tormenta_spell_mao_poderosa_de_talude: 'tormenta_spell_mao_poderosa_de_talude.png',
    tormenta_spell_desejo: 'tormenta_spell_desejo.png',
    tormenta_spell_buraco_negro: 'tormenta_spell_buraco_negro.png',
    tormenta_spell_chuva_de_meteoros: 'tormenta_spell_chuva_de_meteoros.png',
    tormenta_spell_intervencao_divina: 'tormenta_spell_intervencao_divina.png',
    tormenta_spell_mata_dragao: 'tormenta_spell_mata_dragao.png',
};

const CARD_CATALOG = [
    {
        id: 'class_warrior', type: 'Classe', name: 'Guerreiro', emoji: '⚔️', rarity: 'Comum',
    },
    {
        id: 'class_rogue', type: 'Classe', name: 'Ladino', emoji: '🗡️', rarity: 'Comum',
    },
    {
        id: 'class_ranger', type: 'Classe', name: 'Patrulheiro', emoji: '🏹', rarity: 'Comum',
    },
    {
        id: 'class_bard', type: 'Classe', name: 'Bardo', emoji: '🪕', rarity: 'Incomum',
    },
    {
        id: 'class_cleric', type: 'Classe', name: 'Clérigo', emoji: '✨', rarity: 'Incomum',
    },
    {
        id: 'class_barbarian', type: 'Classe', name: 'Bárbaro', emoji: '🪓', rarity: 'Incomum',
    },
    {
        id: 'class_monk', type: 'Classe', name: 'Monge', emoji: '🥋', rarity: 'Incomum',
    },
    {
        id: 'class_druid', type: 'Classe', name: 'Druida', emoji: '🌿', rarity: 'Raro',
    },
    {
        id: 'class_paladin', type: 'Classe', name: 'Paladino', emoji: '🛡️', rarity: 'Raro',
    },
    {
        id: 'class_sorcerer', type: 'Classe', name: 'Feiticeiro', emoji: '🔮', rarity: 'Raro',
    },
    {
        id: 'class_artificer', type: 'Classe', name: 'Artífice', emoji: '⚙️', rarity: 'Raro',
    },
    {
        id: 'class_warlock', type: 'Classe', name: 'Bruxo', emoji: '👁️', rarity: 'Épico',
    },
    {
        id: 'class_wizard', type: 'Classe', name: 'Arquimago', emoji: '🧙', rarity: 'Épico',
    },
    {
        id: 'class_necromancer', type: 'Classe', name: 'Necromante', emoji: '💀', rarity: 'Lendário',
    },
    {
        id: 'class_runeknight', type: 'Classe', name: 'Cavaleiro Rúnico', emoji: '⚜️', rarity: 'Lendário',
    },
    {
        id: 'class_chronomancer', type: 'Classe', name: 'Cronomante', emoji: '⌛', rarity: 'Mítico',
    },
    {
        id: 'race_human', type: 'Raça', name: 'Humano', emoji: '🧑', rarity: 'Comum',
    },
    {
        id: 'race_elf', type: 'Raça', name: 'Elfo', emoji: '🧝', rarity: 'Comum',
    },
    {
        id: 'race_dwarf', type: 'Raça', name: 'Anão', emoji: '⛏️', rarity: 'Comum',
    },
    {
        id: 'race_halfling', type: 'Raça', name: 'Pequenino', emoji: '🍀', rarity: 'Comum',
    },
    {
        id: 'race_orc', type: 'Raça', name: 'Orc', emoji: '🦷', rarity: 'Incomum',
    },
    {
        id: 'race_gnome', type: 'Raça', name: 'Gnomo', emoji: '🍄', rarity: 'Incomum',
    },
    {
        id: 'race_goblin', type: 'Raça', name: 'Goblin', emoji: '👺', rarity: 'Incomum',
    },
    {
        id: 'race_kobold', type: 'Raça', name: 'Kobold', emoji: '🦎', rarity: 'Incomum',
    },
    {
        id: 'race_tiefling', type: 'Raça', name: 'Tiefling', emoji: '😈', rarity: 'Raro',
    },
    {
        id: 'race_dragonborn', type: 'Raça', name: 'Draconato', emoji: '🐲', rarity: 'Raro',
    },
    {
        id: 'race_genasi', type: 'Raça', name: 'Genasi', emoji: '🌊', rarity: 'Raro',
    },
    {
        id: 'race_tabaxi', type: 'Raça', name: 'Tabaxi', emoji: '🐈', rarity: 'Raro',
    },
    {
        id: 'race_aasimar', type: 'Raça', name: 'Aasimar', emoji: '🪽', rarity: 'Épico',
    },
    {
        id: 'race_firbolg', type: 'Raça', name: 'Firbolg', emoji: '🌲', rarity: 'Épico',
    },
    {
        id: 'race_changeling', type: 'Raça', name: 'Metamorfo', emoji: '🎭', rarity: 'Épico',
    },
    {
        id: 'race_triton', type: 'Raça', name: 'Tritão', emoji: '🔱', rarity: 'Lendário',
    },
    {
        id: 'race_celestial', type: 'Raça', name: 'Celestial', emoji: '🌟', rarity: 'Lendário',
    },
    {
        id: 'race_ancient_dragon', type: 'Raça', name: 'Dragão Ancestral', emoji: '🐉', rarity: 'Mítico',
    },
    {
        id: 'terrain_ancient_forest', type: 'Terreno', name: 'Floresta Antiga', emoji: '🌲', rarity: 'Comum',
    },
    {
        id: 'terrain_golden_plains', type: 'Terreno', name: 'Planícies Douradas', emoji: '🌾', rarity: 'Comum',
    },
    {
        id: 'terrain_witch_swamp', type: 'Terreno', name: 'Pântano das Bruxas', emoji: '🌫️', rarity: 'Incomum',
    },
    {
        id: 'terrain_scarlet_desert', type: 'Terreno', name: 'Deserto Escarlate', emoji: '🏜️', rarity: 'Incomum',
    },
    {
        id: 'terrain_lost_kingdom_ruins', type: 'Terreno', name: 'Ruínas do Reino Perdido', emoji: '🏚️', rarity: 'Raro',
    },
    {
        id: 'terrain_underground_city', type: 'Terreno', name: 'Cidade Subterrânea', emoji: '🕳️', rarity: 'Raro',
    },
    {
        id: 'terrain_floating_islands', type: 'Terreno', name: 'Ilhas Flutuantes', emoji: '☁️', rarity: 'Épico',
    },
    {
        id: 'terrain_dragon_valley', type: 'Terreno', name: 'Vale dos Dragões', emoji: '🐲', rarity: 'Épico',
    },
    {
        id: 'terrain_infinite_library', type: 'Terreno', name: 'Biblioteca Infinita', emoji: '📚', rarity: 'Lendário',
    },
    {
        id: 'terrain_worlds_end_throne', type: 'Terreno', name: 'Trono do Fim do Mundo', emoji: '👑', rarity: 'Lendário',
    },
    {
        id: 'terrain_astral_realm', type: 'Terreno', name: 'Reino Astral', emoji: '🌌', rarity: 'Mítico',
    },
    {
        id: 'terrain_world_heart', type: 'Terreno', name: 'Coração do Mundo', emoji: '💠', rarity: 'Mítico',
    },
    {
        id: 'tormenta_deity_aharadak', type: 'Divindade de Arton', name: 'Aharadak', emoji: '👁️', rarity: 'Mítico',
    },
    {
        id: 'tormenta_deity_allihanna', type: 'Divindade de Arton', name: 'Allihanna', emoji: '🌿', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_arsenal', type: 'Divindade de Arton', name: 'Arsenal', emoji: '⚒️', rarity: 'Mítico',
    },
    {
        id: 'tormenta_deity_azgher', type: 'Divindade de Arton', name: 'Azgher', emoji: '☀️', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_hyninn', type: 'Divindade de Arton', name: 'Hyninn', emoji: '🎭', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_kallyadranoch', type: 'Divindade de Arton', name: 'Kallyadranoch', emoji: '🐉', rarity: 'Mítico',
    },
    {
        id: 'tormenta_deity_khalmyr', type: 'Divindade de Arton', name: 'Khalmyr', emoji: '⚖️', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_lena', type: 'Divindade de Arton', name: 'Lena', emoji: '🌱', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_lin_wu', type: 'Divindade de Arton', name: 'Lin-Wu', emoji: '🐲', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_marah', type: 'Divindade de Arton', name: 'Marah', emoji: '🕊️', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_megalokk', type: 'Divindade de Arton', name: 'Megalokk', emoji: '🦖', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_nimb', type: 'Divindade de Arton', name: 'Nimb', emoji: '🎲', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_oceano', type: 'Divindade de Arton', name: 'Oceano', emoji: '🌊', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_sszzaas', type: 'Divindade de Arton', name: 'Sszzaas', emoji: '🐍', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_tanna_toh', type: 'Divindade de Arton', name: 'Tanna-Toh', emoji: '📚', rarity: 'Épico',
    },
    {
        id: 'tormenta_deity_tenebra', type: 'Divindade de Arton', name: 'Tenebra', emoji: '🌑', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_thwor', type: 'Divindade de Arton', name: 'Thwor', emoji: '✊', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_thyatis', type: 'Divindade de Arton', name: 'Thyatis', emoji: '🔥', rarity: 'Lendário',
    },
    {
        id: 'tormenta_deity_valkaria', type: 'Divindade de Arton', name: 'Valkaria', emoji: '⚔️', rarity: 'Mítico',
    },
    {
        id: 'tormenta_deity_wynna', type: 'Divindade de Arton', name: 'Wynna', emoji: '🔮', rarity: 'Lendário',
    },
    {
        id: 'tormenta_fallen_glorienn', type: 'Divindade Caída', name: 'Glórienn', emoji: '🏹', rarity: 'Lendário',
    },
    {
        id: 'tormenta_fallen_keenn', type: 'Divindade Caída', name: 'Keenn', emoji: '🪓', rarity: 'Mítico',
    },
    {
        id: 'tormenta_fallen_ragnar', type: 'Divindade Caída', name: 'Ragnar', emoji: '💀', rarity: 'Mítico',
    },
    {
        id: 'tormenta_fallen_tauron', type: 'Divindade Caída', name: 'Tauron', emoji: '🐂', rarity: 'Mítico',
    },
    {
        id: 'tormenta_fallen_tillian', type: 'Divindade Caída', name: 'Tillian', emoji: '⚙️', rarity: 'Lendário',
    },
    {
        id: 'tormenta_forgotten_divina_serpente', type: 'Divindade Esquecida', name: 'Divina Serpente', emoji: '🐍', rarity: 'Lendário',
    },
    {
        id: 'tormenta_minor_sckhar', type: 'Deus Menor', name: 'Sckhar', emoji: '🐲', rarity: 'Lendário',
    },
    {
        id: 'tormenta_minor_beluhga', type: 'Deus Menor', name: 'Beluhga', emoji: '❄️', rarity: 'Lendário',
    },
    {
        id: 'tormenta_minor_benthos', type: 'Deus Menor', name: 'Benthos', emoji: '🔱', rarity: 'Lendário',
    },
    {
        id: 'tormenta_minor_rhond', type: 'Deus Menor', name: 'Rhond', emoji: '🔨', rarity: 'Épico',
    },
    {
        id: 'tormenta_minor_hippion', type: 'Deus Menor', name: 'Hippion', emoji: '🐎', rarity: 'Épico',
    },
    {
        id: 'tormenta_minor_tibar', type: 'Deus Menor', name: 'Tibar', emoji: '🪙', rarity: 'Épico',
    },
    {
        id: 'tormenta_legend_lisandra', type: 'Lenda de Arton', name: 'Lisandra', emoji: '🌹', rarity: 'Épico',
    },
    {
        id: 'tormenta_legend_sandro_galtran', type: 'Lenda de Arton', name: 'Sandro Galtran', emoji: '🗡️', rarity: 'Raro',
    },
    {
        id: 'tormenta_legend_niele', type: 'Lenda de Arton', name: 'Niele', emoji: '🎵', rarity: 'Lendário',
    },
    {
        id: 'tormenta_legend_tork', type: 'Lenda de Arton', name: 'Tork', emoji: '⚒️', rarity: 'Épico',
    },
    defineSpellCard(
        'tormenta_spell_curar_ferimentos',
        'Curar Ferimentos',
        '💚',
        'Comum',
        1,
        'Evocação',
        'Divina',
    ),
    defineSpellCard(
        'tormenta_spell_seta_infalivel_de_talude',
        'Seta Infalível de Talude',
        '✦',
        'Incomum',
        1,
        'Evocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_armadura_arcana',
        'Armadura Arcana',
        '🛡️',
        'Comum',
        1,
        'Abjuração',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_conjurar_monstro',
        'Conjurar Monstro',
        '👹',
        'Comum',
        1,
        'Convocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_sono',
        'Sono',
        '🌙',
        'Comum',
        1,
        'Encantamento',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_bola_de_fogo',
        'Bola de Fogo',
        '🔥',
        'Incomum',
        2,
        'Evocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_dissipar_magia',
        'Dissipar Magia',
        '💫',
        'Incomum',
        2,
        'Abjuração',
        'Universal',
    ),
    defineSpellCard(
        'tormenta_spell_relampago',
        'Relâmpago',
        '⚡',
        'Incomum',
        2,
        'Evocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_velocidade',
        'Velocidade',
        '💨',
        'Incomum',
        2,
        'Transmutação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_oracao',
        'Oração',
        '🙏',
        'Incomum',
        2,
        'Encantamento',
        'Divina',
    ),
    defineSpellCard(
        'tormenta_spell_teletransporte',
        'Teletransporte',
        '🌀',
        'Raro',
        3,
        'Convocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_voo',
        'Voo',
        '🪽',
        'Raro',
        3,
        'Transmutação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_servo_morto_vivo',
        'Servo Morto-Vivo',
        '💀',
        'Raro',
        3,
        'Necromancia',
        'Universal',
    ),
    defineSpellCard(
        'tormenta_spell_transformacao_de_guerra',
        'Transformação de Guerra',
        '⚔️',
        'Raro',
        3,
        'Transmutação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_enxame_rubro_de_ichabod',
        'Enxame Rubro de Ichabod',
        '🦂',
        'Épico',
        3,
        'Convocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_desintegrar',
        'Desintegrar',
        '☄️',
        'Épico',
        4,
        'Transmutação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_campo_antimagia',
        'Campo Antimagia',
        '🚫',
        'Épico',
        4,
        'Abjuração',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_guardiao_divino',
        'Guardião Divino',
        '🌟',
        'Épico',
        4,
        'Convocação',
        'Divina',
    ),
    defineSpellCard(
        'tormenta_spell_terremoto',
        'Terremoto',
        '🌋',
        'Épico',
        4,
        'Evocação',
        'Divina',
    ),
    defineSpellCard(
        'tormenta_spell_mao_poderosa_de_talude',
        'Mão Poderosa de Talude',
        '✋',
        'Lendário',
        4,
        'Convocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_desejo',
        'Desejo',
        '🌠',
        'Mítico',
        5,
        'Transmutação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_buraco_negro',
        'Buraco Negro',
        '⚫',
        'Mítico',
        5,
        'Convocação',
        'Universal',
    ),
    defineSpellCard(
        'tormenta_spell_chuva_de_meteoros',
        'Chuva de Meteoros',
        '☄️',
        'Lendário',
        5,
        'Convocação',
        'Arcana',
    ),
    defineSpellCard(
        'tormenta_spell_intervencao_divina',
        'Intervenção Divina',
        '✨',
        'Mítico',
        5,
        'Convocação',
        'Divina',
    ),
    defineSpellCard(
        'tormenta_spell_mata_dragao',
        'Mata-Dragão',
        '🐉',
        'Mítico',
        5,
        'Evocação',
        'Arcana',
    ),
];

const CARD_BY_ID = new Map(CARD_CATALOG.map((card) => [card.id, card]));

function getCard(cardId) {
    return CARD_BY_ID.get(cardId);
}

function getCardArtwork(cardOrId) {
    const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
    const filename = CARD_ARTWORK[cardId];
    if (!filename) return null;

    const sourceAttachment = path.join(__dirname, '..', 'assets', 'cards', filename);
    return getDisplayAttachment(sourceAttachment, filename);
}

function isSpellCard(card) {
    return card?.type === SPELL_CARD_TYPE;
}

function getPackCards(packType = 'basic') {
    if (packType === 'grimoire') return CARD_CATALOG.filter(isSpellCard);
    return CARD_CATALOG;
}

function getCardsByRarity(rarity, packType = null) {
    const cards = packType ? getPackCards(packType) : CARD_CATALOG;
    return cards.filter((card) => card.rarity === rarity);
}

function getPackSpellChance(packType, rarity) {
    const chances = PACK_SPELL_CHANCES[packType] || PACK_SPELL_CHANCES.basic;
    return chances[rarity] || 0;
}

function getLegacyCardQuantity(profile, cardId) {
    if (profile?.cards?.get) return Number(profile.cards.get(cardId)) || 0;
    return Number(profile?.cards?.[cardId]) || 0;
}

function generateFloat(randomInteger = randomInt) {
    return randomInteger(FLOAT_PRECISION + 1) / FLOAT_PRECISION;
}

function formatFloat(float) {
    return Math.min(1, Math.max(0, Number(float) || 0)).toFixed(6);
}

function getCardState(float) {
    const numericFloat = Number(float);
    const normalized = Number.isFinite(numericFloat)
        ? Math.min(1, Math.max(0, numericFloat))
        : 1;
    const index = FLOAT_CONDITIONS.findIndex((condition) => normalized < condition.maximum);
    const resolvedIndex = index >= 0 ? index : FLOAT_CONDITIONS.length - 1;
    const condition = FLOAT_CONDITIONS[resolvedIndex];

    return {
        ...condition,
        minimum: resolvedIndex === 0 ? 0 : FLOAT_CONDITIONS[resolvedIndex - 1].maximum,
        float: normalized,
    };
}

// Compatibilidade com chamadas antigas. O estado nunca é sorteado ou salvo:
// ele é sempre recalculado a partir do Float da instância.
function getFloatCondition(float) {
    return getCardState(float);
}

function getCardValue(cardOrId, float) {
    const card = typeof cardOrId === 'string' ? getCard(cardOrId) : cardOrId;
    if (!card) return 0;

    const normalized = Math.min(1, Math.max(0, Number(float) || 0));
    const wearMultiplier = 0.35 + (1.65 * ((1 - normalized) ** 2));
    let collectorMultiplier = 1;
    if (normalized < 0.001) collectorMultiplier = 1.75;
    else if (normalized < 0.01) collectorMultiplier = 1.25;
    return Math.max(1, Math.round(
        CARD_BASE_VALUES[card.rarity] * wearMultiplier * collectorMultiplier,
    ));
}

function createCardInstance(cardOrId, randomInteger = randomInt, uuid = randomUUID) {
    const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
    if (!getCard(cardId)) throw new Error('Não é possível criar uma instância de carta inválida.');
    return {
        uid: uuid(),
        cardId,
        float: generateFloat(randomInteger),
        acquiredAt: new Date(),
    };
}

function getCardInstances(profile, cardId = null) {
    const instances = Array.from(profile?.cardInstances || [])
        .filter((instance) => instance?.uid && getCard(instance.cardId));
    const filtered = cardId
        ? instances.filter((instance) => instance.cardId === cardId)
        : instances;
    return filtered.sort((left, right) => Number(left.float) - Number(right.float));
}

function setCardQuantity(profile, cardId, quantity) {
    const normalized = Math.max(0, Number(quantity) || 0);
    if (profile?.cards?.set) profile.cards.set(cardId, normalized);
    else {
        if (!profile.cards) profile.cards = {};
        profile.cards[cardId] = normalized;
    }
}

function migrateLegacyCardInstances(profile) {
    if (!profile) return 0;
    if (!Array.isArray(profile.cardInstances)) profile.cardInstances = [];

    let changes = 0;
    CARD_CATALOG.forEach((card) => {
        const stored = getLegacyCardQuantity(profile, card.id);
        const current = getCardInstances(profile, card.id).length;
        for (let index = current; index < stored; index += 1) {
            profile.cardInstances.push(createCardInstance(card.id));
            changes += 1;
        }
        if (current > stored) {
            setCardQuantity(profile, card.id, current);
            changes += 1;
        }
    });

    const legacyMarriages = Array.from(profile.marriedCards || []);
    legacyMarriages.forEach((identifier) => {
        const card = getCard(identifier);
        if (!card) return;
        const instance = getCardInstances(profile, card.id)[0];
        if (!instance) return;
        profile.marriedCards = profile.marriedCards
            .filter((value) => value !== identifier);
        if (!profile.marriedCards.includes(instance.uid)) profile.marriedCards.push(instance.uid);
        changes += 1;
    });

    return changes;
}

function resolveCardInstance(profile, identifier) {
    const instances = getCardInstances(profile);
    return instances.find((instance) => instance.uid === identifier)
        || instances.find((instance) => instance.cardId === identifier)
        || null;
}

function addCardInstance(profile, instance) {
    if (!Array.isArray(profile.cardInstances)) profile.cardInstances = [];
    profile.cardInstances.push(instance);
    setCardQuantity(
        profile,
        instance.cardId,
        getCardInstances(profile, instance.cardId).length,
    );
}

function removeCardInstances(profile, instanceIds) {
    const removed = getCardInstances(profile)
        .filter((instance) => instanceIds.includes(instance.uid));
    profile.cardInstances = Array.from(profile.cardInstances || [])
        .filter((instance) => !instanceIds.includes(instance.uid));
    profile.marriedCards = Array.from(profile.marriedCards || [])
        .filter((identifier) => !instanceIds.includes(identifier));
    instanceIds.forEach((instanceId) => {
        if (profile?.cardDescriptions?.delete) profile.cardDescriptions.delete(instanceId);
        else if (profile?.cardDescriptions) delete profile.cardDescriptions[instanceId];
    });
    new Set(removed.map((instance) => instance.cardId)).forEach((cardId) => {
        setCardQuantity(profile, cardId, getCardInstances(profile, cardId).length);
    });
    return removed;
}

function getCardQuantity(profile, cardId) {
    return Math.max(getCardInstances(profile, cardId).length, getLegacyCardQuantity(profile, cardId));
}

function getCardTotal(profile) {
    return CARD_CATALOG.reduce(
        (total, card) => total + getCardQuantity(profile, card.id),
        0,
    );
}

function getCardDescription(profile, identifier) {
    const instance = resolveCardInstance(profile, identifier);
    const legacyCardId = instance?.cardId || identifier;
    if (profile?.cardDescriptions?.get) {
        return profile.cardDescriptions.get(identifier)
            || profile.cardDescriptions.get(legacyCardId)
            || '';
    }
    return profile?.cardDescriptions?.[identifier]
        || profile?.cardDescriptions?.[legacyCardId]
        || '';
}

function isCardMarried(profile, identifier) {
    if (!Array.isArray(profile?.marriedCards)) return false;
    if (profile.marriedCards.includes(identifier)) return true;
    const instance = resolveCardInstance(profile, identifier);
    return Boolean(instance && profile.marriedCards.includes(instance.cardId));
}

function getOwnedCards(profile, minimumQuantity = 1) {
    return CARD_CATALOG
        .map((card) => {
            const instances = getCardInstances(profile, card.id);
            const bestInstance = instances[0] || null;
            return {
                ...card,
                quantity: getCardQuantity(profile, card.id),
                instances,
                bestInstance,
                bestFloat: bestInstance?.float,
                bestValue: bestInstance ? getCardValue(card, bestInstance.float) : 0,
                totalValue: instances.reduce(
                    (total, instance) => total + getCardValue(card, instance.float),
                    0,
                ),
            };
        })
        .filter((card) => card.quantity >= minimumQuantity);
}

function getCollectionValue(profile) {
    return getCardInstances(profile).reduce((total, instance) => (
        total + getCardValue(instance.cardId, instance.float)
    ), 0);
}

function pickRandom(items, randomInteger = randomInt) {
    return items[randomInteger(items.length)];
}

function pickBalancedCard(items, randomInteger = randomInt) {
    const categories = [...new Set(items.map((card) => card.type))];
    const category = pickRandom(categories, randomInteger);
    return pickRandom(
        items.filter((card) => card.type === category),
        randomInteger,
    );
}

function drawRarity(packType = 'basic', randomInteger = randomInt) {
    const roll = randomInteger(10_000);
    let thresholds = [4_500, 7_500, 9_100, 9_800, 9_980, 10_000];
    if (packType === 'arcane') thresholds = [0, 0, 4_500, 7_500, 9_600, 10_000];
    if (packType === 'grimoire') thresholds = [3_500, 6_000, 8_000, 9_200, 9_800, 10_000];

    return RARITIES[thresholds.findIndex((threshold) => roll < threshold)];
}

function drawCard(packType = 'basic', randomInteger = randomInt, rarityBoost = 0) {
    const rolledRarity = drawRarity(packType, randomInteger);
    const rarityIndex = Math.min(
        RARITIES.length - 1,
        RARITIES.indexOf(rolledRarity) + Math.max(0, rarityBoost),
    );
    const rarity = RARITIES[rarityIndex];
    const spellChance = getPackSpellChance(packType, rarity);
    const drawsSpell = spellChance >= 100
        || (spellChance > 0 && randomInteger(10_000) < spellChance * 100);
    const candidates = getCardsByRarity(rarity, packType)
        .filter((card) => isSpellCard(card) === drawsSpell);
    return pickBalancedCard(candidates, randomInteger);
}

function combineCards(card, randomInteger = randomInt) {
    const currentIndex = RARITIES.indexOf(card.rarity);
    if (currentIndex < 0 || currentIndex === RARITIES.length - 1) {
        throw new Error('Cartas míticas não podem ser combinadas.');
    }

    const chance = COMBINE_CHANCES[card.rarity];
    const upgraded = randomInteger(100) < chance;
    const resultRarity = upgraded ? RARITIES[currentIndex + 1] : card.rarity;

    return {
        chance,
        upgraded,
        card: pickRandom(
            getCardsByRarity(resultRarity)
                .filter((candidate) => isSpellCard(candidate) === isSpellCard(card)),
            randomInteger,
        ),
    };
}

module.exports = {
    CARD_BASE_VALUES,
    CARD_CATALOG,
    COMBINE_CHANCES,
    FLOAT_CONDITIONS,
    PACK_SPELL_CHANCES,
    RARITIES,
    RARITY_COLORS,
    SPELL_CARD_TYPE,
    addCardInstance,
    combineCards,
    createCardInstance,
    drawCard,
    drawRarity,
    formatFloat,
    getCard,
    getCardArtwork,
    getCardDescription,
    getCardInstances,
    getCardQuantity,
    getCardState,
    getCardTotal,
    getCardValue,
    getCardsByRarity,
    getCollectionValue,
    getFloatCondition,
    getPackCards,
    getOwnedCards,
    getPackSpellChance,
    isCardMarried,
    isSpellCard,
    migrateLegacyCardInstances,
    removeCardInstances,
    resolveCardInstance,
    setCardQuantity,
};
