const DEFAULT_RETRY_DELAYS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
const RETRYABLE_CODES = new Set([
    'ABORT_ERR',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
]);

function isRetryableDiscordLoginError(error) {
    const status = Number(error?.status ?? error?.statusCode ?? error?.rawError?.status);
    if (status === 429 || status >= 500) return true;

    const code = error?.code ?? error?.cause?.code;
    if (RETRYABLE_CODES.has(code)) return true;

    return /internal server error|fetch failed|network|socket hang up|temporarily unavailable/i
        .test(String(error?.message || ''));
}

function waitForRetry(delay, signal) {
    if (signal?.aborted) return Promise.resolve();

    return new Promise((resolve) => {
        let timeout;
        const finish = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', finish);
            resolve();
        };
        timeout = setTimeout(finish, delay);
        signal?.addEventListener('abort', finish, { once: true });
    });
}

async function loginWithRetry(client, token, options = {}) {
    const {
        delays = DEFAULT_RETRY_DELAYS,
        onRetry = () => {},
        signal,
        wait = waitForRetry,
    } = options;
    let failures = 0;

    while (!signal?.aborted) {
        try {
            return await client.login(token); // eslint-disable-line no-await-in-loop
        } catch (error) {
            if (!isRetryableDiscordLoginError(error)) throw error;
            const retryDelay = delays[Math.min(failures, delays.length - 1)];
            failures += 1;
            onRetry(error, { attempt: failures, delay: retryDelay });
            await wait(retryDelay, signal); // eslint-disable-line no-await-in-loop
        }
    }

    return null;
}

module.exports = {
    DEFAULT_RETRY_DELAYS,
    isRetryableDiscordLoginError,
    loginWithRetry,
    waitForRetry,
};
