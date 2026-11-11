function safelyDestroyVoiceConnection(connection) {
    if (!connection || connection.destroyed) return false;

    try {
        connection.destroy();
        return true;
    } catch (error) {
        const alreadyDestroyed = connection.destroyed
            || /already been destroyed/i.test(error?.message ?? '');
        if (alreadyDestroyed) return false;
        throw error;
    }
}

module.exports = { safelyDestroyVoiceConnection };
