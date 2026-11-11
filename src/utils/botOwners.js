const BOT_OWNER_IDS = Object.freeze([
    '1467356224487161876',
    '335012394226941966',
]);

const botOwnerLookup = new Set(BOT_OWNER_IDS);

function isBotOwner(userId) {
    return botOwnerLookup.has(String(userId));
}

module.exports = { BOT_OWNER_IDS, isBotOwner };
