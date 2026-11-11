const silent = () => {};

function enableErrorOnlyConsole(targetConsole = console) {
    Object.assign(targetConsole, {
        log: silent,
        info: silent,
        warn: silent,
        debug: silent,
        trace: silent,
    });
}

module.exports = { enableErrorOnlyConsole };
