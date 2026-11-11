const mongoose = require('mongoose');

const cardInstanceSchema = new mongoose.Schema({
    uid: { type: String, required: true },
    cardId: { type: String, required: true },
    float: {
        type: Number, required: true, min: 0, max: 1,
    },
    acquiredAt: { type: Date, default: Date.now },
}, { _id: false });

const profileSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    points: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    money: { type: Number, default: 0 },
    rank: { type: String, default: 'Novato' },
    emblems: { type: [String], default: [] },
    rewards: { type: [String], default: [] },
    cardPacks: {
        basic: { type: Number, default: 3, min: 0 },
        arcane: { type: Number, default: 0, min: 0 },
        grimoire: { type: Number, default: 0, min: 0 },
    },
    cards: {
        type: Map,
        of: Number,
        default: {},
    },
    cardInstances: {
        type: [cardInstanceSchema],
        default: [],
    },
    cardInventory: {
        capacity: {
            type: Number, default: 20, min: 20, max: 100,
        },
        organizerLevel: {
            type: Number, default: 0, min: 0, max: 3,
        },
        sortMode: {
            type: String,
            enum: ['rarity', 'name', 'type', 'quantity'],
            default: 'rarity',
        },
        rarityBoosters: { type: Number, default: 0, min: 0 },
        descriptionScrolls: { type: Number, default: 0, min: 0 },
        weddingRings: { type: Number, default: 0, min: 0 },
    },
    cardDescriptions: {
        type: Map,
        of: { type: String, maxlength: 120 },
        default: {},
    },
    marriedCards: { type: [String], default: [] },
    customizations: {
        color: {
            type: String,
            default: '#8B1E2D',
            match: /^#[0-9a-f]{6}$/i,
        },
        title: {
            type: String, default: '', trim: true, maxlength: 30,
        },
        motto: {
            type: String, default: '', trim: true, maxlength: 80,
        },
        crest: {
            type: String, default: '⚔️', trim: true, maxlength: 8,
        },
    },
    lastDaily: { type: Date, default: null },
    lastInteraction: { type: Date, default: null },
}, { timestamps: true });

profileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Profile', profileSchema);
