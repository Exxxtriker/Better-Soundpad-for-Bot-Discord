const dns = require('node:dns');

const PUBLIC_DNS_SERVERS = Object.freeze(['1.1.1.1', '8.8.8.8']);

function isLoopbackDnsServer(server) {
    const normalized = String(server ?? '').trim().toLowerCase();
    return normalized === '::1'
        || normalized === '0:0:0:0:0:0:0:1'
        || normalized.startsWith('127.')
        || normalized.startsWith('::ffff:127.');
}

function shouldUsePublicDns(servers, customDnsSetting = process.env.CUSTOM_DNS) {
    if (customDnsSetting === 'true') return true;
    if (customDnsSetting === 'false') return false;
    return servers.length === 0 || servers.every(isLoopbackDnsServer);
}

function configureDnsResolver(options = {}) {
    const resolver = options.resolver ?? dns;
    const publicServers = options.publicServers ?? PUBLIC_DNS_SERVERS;
    const customDnsSetting = options.customDnsSetting ?? process.env.CUSTOM_DNS;
    const currentServers = resolver.getServers();
    const changed = shouldUsePublicDns(currentServers, customDnsSetting);

    if (changed) resolver.setServers(publicServers);
    return {
        changed,
        previousServers: currentServers,
        activeServers: resolver.getServers(),
    };
}

module.exports = {
    PUBLIC_DNS_SERVERS,
    configureDnsResolver,
    isLoopbackDnsServer,
    shouldUsePublicDns,
};
