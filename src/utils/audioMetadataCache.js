function createAudioMetadataCache({ ttlMs = 5 * 60_000, maxEntries = 128, now = Date.now } = {}) {
    const entries = new Map();
    const pending = new Map();

    async function load(key, loader) {
        const cached = entries.get(key);
        if (cached && cached.expiresAt > now()) {
            entries.delete(key);
            entries.set(key, cached);
            return structuredClone(cached.value);
        }
        entries.delete(key);
        if (!pending.has(key)) {
            const request = Promise.resolve().then(loader).then((value) => {
                const snapshot = structuredClone(value);
                if (!snapshot.isLive) {
                    entries.set(key, { value: snapshot, expiresAt: now() + ttlMs });
                    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
                }
                return snapshot;
            });
            pending.set(key, request);
            request.finally(() => {
                if (pending.get(key) === request) pending.delete(key);
            }).catch(() => {});
        }
        return structuredClone(await pending.get(key));
    }

    function invalidate(key) {
        entries.delete(key);
    }

    return { load, invalidate };
}

module.exports = { createAudioMetadataCache };
