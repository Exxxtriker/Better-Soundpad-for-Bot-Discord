const Profile = require('../models/profile');
const { migrateLegacyCardInstances } = require('./cardCatalog');

const XP_PER_ACTION = 1;
const POINTS_PER_ACTION = 2;
const progressUpdateQueues = new Map();

function calculateRank(level) {
    if (level >= 90) return 'Ancião';
    if (level >= 70) return 'Lendário';
    if (level >= 50) return 'Mestre';
    if (level >= 30) return 'Herói';
    if (level >= 10) return 'Aventureiro';
    return 'Novato';
}

async function updateProgress(guildId, userId, username) {
    const now = new Date();
    const profile = await Profile.findOneAndUpdate(
        { guildId, userId },
        {
            $inc: { points: POINTS_PER_ACTION, xp: XP_PER_ACTION },
            $set: { lastInteraction: now, username },
            $setOnInsert: { guildId, userId },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    let leveledUp = false;
    while (profile.xp >= profile.level * 100) {
        profile.xp -= profile.level * 100;
        profile.level += 1;
        leveledUp = true;
    }

    if (leveledUp) {
        profile.rank = calculateRank(profile.level);
        await profile.save();
    }
    return profile;
}

async function withProfileLock(guildId, userId, operation) {
    const lockKey = `${guildId}:${userId}`;
    const previous = progressUpdateQueues.get(lockKey) ?? Promise.resolve();
    const update = previous.catch(() => {}).then(operation);
    progressUpdateQueues.set(lockKey, update);
    try {
        return await update;
    } finally {
        if (progressUpdateQueues.get(lockKey) === update) progressUpdateQueues.delete(lockKey);
    }
}

async function addInteraction(guildId, userId, username) {
    return withProfileLock(guildId, userId, () => updateProgress(guildId, userId, username));
}

// Verifica emblemas e desbloqueia recompensas
async function checkEmblems(profile) {
    const newEmblems = [];
    const newRewards = [];

    profile.emblems = profile.emblems || [];
    profile.rewards = profile.rewards || [];

    // Regras mais difíceis para desbloqueio
    const emblemRules = [
        {
            points: 50, level: 0, emblem: '<:d4:1412780743117246615> Novato',
        },
        {
            points: 250, level: 5, emblem: '<:d6:1412780753904996435> Interativo',
        },
        {
            points: 1000, level: 10, emblem: '<:d8:1412780768740114543> Herói',
        },
        {
            points: 3000, level: 20, emblem: '<:d10:1412780786675089478> Mestre',
        },
        {
            points: 7000, level: 35, emblem: '<:d12:1412780918837477387> Lendário',
        },
        {
            points: 15000, level: 50, emblem: '<:d20:1412780936055230567> Ancião',
        },
        {
            points: 30000, level: 70, emblem: '<:rpggoldshield:1412780636032209009> Imortal',
        },
        {
            points: 50000, level: 90, emblem: '<:rpgbigsword:1412780685571129374> Deus',
        },
        {
            points: 90000, level: 100, emblem: '<:rpgwarhammer:1412780570290815046> Eterno',
        },
    ];

    for (const rule of emblemRules) {
        if (
            profile.points >= rule.points
            && profile.level >= rule.level
            && !profile.emblems.includes(rule.emblem)
        ) {
            profile.emblems.push(rule.emblem);
            newEmblems.push(rule.emblem);
        }
    }

    if (newEmblems.length > 0 || newRewards.length > 0) await profile.save();
    return { newEmblems, newRewards };
}

async function getProfile(guildId, userId) {
    const profile = await Profile.findOne({ guildId, userId });
    if (profile && migrateLegacyCardInstances(profile) > 0) await profile.save();
    return profile;
}

module.exports = {
    addInteraction,
    calculateRank,
    checkEmblems,
    getProfile,
    withProfileLock,
};
