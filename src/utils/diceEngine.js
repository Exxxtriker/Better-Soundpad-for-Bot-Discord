const { randomInt } = require('node:crypto');

const LIMITS = Object.freeze({
    message: 2000,
    expression: 500,
    nodes: 200,
    depth: 32,
    repetitions: 20,
    results: 20,
    dicePerTerm: 100,
    sides: 100000,
    draws: 1000,
    output: 1900,
});
const numberFormatter = new Intl.NumberFormat('pt-BR', { useGrouping: false, maximumFractionDigits: 6 });
const escapeText = (text) => String(text).replace(/[\\`*_~|<>@]/g, '\\$&');

function safeNumber(value) {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('O resultado é grande demais.');
    return value;
}

function rollDie(sides, randomInteger = randomInt) {
    if (!Number.isInteger(sides) || sides < 2 || sides > LIMITS.sides) {
        throw new Error(`Cada dado deve ter entre 2 e ${LIMITS.sides} lados.`);
    }
    const value = randomInteger(1, sides + 1);
    if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error('O gerador retornou um dado inválido.');
    return value;
}

class DiceParser {
    constructor(source) {
        this.source = source;
        this.position = 0;
        this.nodes = 0;
        this.depth = 0;
        this.dice = 0;
        this.operations = 0;
    }

    make(node) {
        this.nodes += 1;
        if (this.nodes > LIMITS.nodes) throw new Error('A expressão possui operações demais.');
        return node;
    }

    skipSpace() {
        while (this.position < this.source.length && /\s/.test(this.source[this.position])) this.position += 1;
    }

    take(operator) {
        const previous = this.position;
        this.skipSpace();
        const after = this.source.slice(this.position + operator.length);
        const wordX = /[xX]/.test(operator) && operator.length === 1
            && !/^\s*(?:\d|[.,]\d|[dD](?:\d|[fF])|\(|[BGWbgw]\d)/.test(after);
        if (!wordX && this.source.startsWith(operator, this.position)) {
            this.position += operator.length;
            return true;
        }
        this.position = previous;
        return false;
    }

    enter() {
        this.depth += 1;
        if (this.depth > LIMITS.depth) throw new Error('A expressão está aninhada demais.');
    }

    parseBinary(next, operators) {
        let left = next();
        let operator = operators.find((candidate) => this.take(candidate));
        while (operator) {
            this.operations += 1;
            left = this.make({
                type: 'binary', operator, left, right: next(),
            });
            operator = operators.find((candidate) => this.take(candidate));
        }
        return left;
    }

    parseSum() {
        return this.parseBinary(() => this.parseProduct(), ['++', '--', '+', '-']);
    }

    parseProduct() {
        return this.parseBinary(() => this.parseUnary(), ['*', '/', 'x', 'X', '×', '÷']);
    }

    parseUnary() {
        const operator = ['+', '-'].find((candidate) => this.take(candidate));
        if (operator) {
            this.enter();
            const argument = this.parseUnary();
            this.depth -= 1;
            this.operations += 1;
            return this.make({ type: 'unary', operator, argument });
        }
        let node = this.parsePrimary();
        if (this.take('%')) {
            this.operations += 1;
            node = this.make({ type: 'percent', argument: node });
        }
        return node;
    }

    parsePrimary() {
        this.skipSpace();
        if (this.take('(')) {
            this.enter();
            const argument = this.parseSum();
            this.depth -= 1;
            if (!this.take(')')) throw new Error('Parêntese não fechado ou comparação fora do final da expressão.');
            return this.make({ type: 'group', argument });
        }
        const remaining = this.source.slice(this.position);
        const dice = remaining.match(/^(?:(\d+)?[dD](\d+|[fF])|([bBgGwW])(\d+))/);
        if (dice) return this.parseDice(dice);
        const numeric = remaining.match(/^(?:\d+(?:[.,]\d+)?|[.,]\d+)/);
        if (!numeric) throw new Error('Era esperado um número, dado ou parêntese.');
        this.position += numeric[0].length;
        return this.make({ type: 'number', value: safeNumber(Number(numeric[0].replace(',', '.'))) });
    }

    parseDice(match) {
        const start = this.position;
        this.position += match[0].length;
        const shadow = match[3]?.toUpperCase() ?? null;
        const count = Number(shadow ? match[4] : (match[1] ?? 1));
        const fate = !shadow && /f/i.test(match[2]);
        let sides = Number(match[2]);
        if (fate) sides = 3;
        if (shadow) sides = 6;
        if (!Number.isInteger(count) || count < 1 || count > LIMITS.dicePerTerm) {
            throw new Error(`Cada termo deve ter entre 1 e ${LIMITS.dicePerTerm} dados.`);
        }
        if (!Number.isInteger(sides) || sides < 2 || sides > LIMITS.sides) {
            throw new Error(`Cada dado deve ter entre 2 e ${LIMITS.sides} lados.`);
        }
        const modifiers = {
            explode: null, keep: null, crit: null, aro: false, noSort: false,
        };
        let matched = true;
        while (matched) {
            const text = this.source.slice(this.position);
            const explosion = text.match(/^!(\d+)?/);
            const selection = text.match(/^(kh|kl|dh|dl|k|d|c)(\d+)/i);
            const aro = text.match(/^(daro|taro|aro)/i);
            if (explosion) {
                if (modifiers.explode !== null || fate) throw new Error('Modificador de explosão inválido ou repetido.');
                modifiers.explode = explosion[1] === undefined ? sides : Number(explosion[1]);
                if (!Number.isSafeInteger(modifiers.explode) || modifiers.explode < 2) {
                    throw new Error('O limiar de explosão deve ser um inteiro maior que 1.');
                }
                this.position += explosion[0].length;
            } else if (aro) {
                if (modifiers.aro || fate || count < 2) throw new Error('ARO requer pelo menos dois dados numéricos.');
                modifiers.aro = true;
                this.position += aro[0].length;
            } else if (selection) {
                if (modifiers.keep || modifiers.crit !== null || fate) throw new Error('Use apenas um modificador de manter, descartar ou crítico.');
                const mode = selection[1].toLowerCase();
                const amount = Number(selection[2]);
                if (!Number.isSafeInteger(amount)) throw new Error('Quantidade de dados inválida.');
                if (mode === 'c') modifiers.crit = amount;
                else modifiers.keep = { mode: ({ k: 'kh', d: 'dl' })[mode] ?? mode, amount: Math.min(count, amount) };
                this.position += selection[0].length;
            } else if (/^ns/i.test(text)) {
                if (modifiers.noSort) throw new Error('O modificador ns está repetido.');
                modifiers.noSort = true;
                this.position += 2;
            } else matched = false;
        }
        if (shadow && (modifiers.keep || modifiers.crit !== null || modifiers.aro)) {
            throw new Error('Use B/G/W com quantidade e explosão opcional.');
        }
        this.dice += count;
        return this.make({
            type: 'dice', count, sides, fate, shadow, modifiers, notation: this.source.slice(start, this.position),
        });
    }

    parseCounter() {
        const left = this.parseSum();
        const operator = ['<<', '>>'].find((candidate) => this.take(candidate));
        if (!operator) return left;
        this.operations += 1;
        return this.make({
            type: 'binary', operator, left, right: this.parseSum(),
        });
    }

    parse() {
        const left = this.parseCounter();
        const operator = ['<=', '>=', '==', '=', '<', '>'].find((candidate) => this.take(candidate));
        if (!operator) return left;
        this.operations += 1;
        return this.make({
            type: 'comparison', operator, left, right: this.parseCounter(),
        });
    }
}

function parseRollExpression(rawInput) {
    if (typeof rawInput !== 'string' || !rawInput.trim() || rawInput.length > LIMITS.expression) {
        throw new Error(`A expressão deve ter entre 1 e ${LIMITS.expression} caracteres.`);
    }
    let source = rawInput.trim();
    const prefix = source.match(/^(\d+)\s*#/);
    const repeat = prefix ? Number(prefix[1]) : 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > LIMITS.repetitions) {
        throw new Error(`Use entre 1 e ${LIMITS.repetitions} repetições.`);
    }
    if (prefix) source = source.slice(prefix[0].length).trimStart();
    const parser = new DiceParser(source);
    const tree = parser.parse();
    const tail = source.slice(parser.position);
    const label = tail.trim();
    if (label && (!/^\s/.test(tail) || /^[+\-*/×÷%<>=]/.test(label))) {
        throw new Error('Expressão incompleta ou modificador inválido. Separe a descrição com um espaço.');
    }
    if (parser.dice * repeat > LIMITS.draws) throw new Error(`Use no máximo ${LIMITS.draws} dados no total.`);
    return {
        tree,
        repeat,
        label,
        expression: source.slice(0, parser.position).trim(),
        baseDice: parser.dice,
        operations: parser.operations,
    };
}

function extractRollRequests(rawInput, strict = true) {
    if (typeof rawInput !== 'string' || rawInput.length > LIMITS.message) throw new Error('A mensagem é grande demais para rolar dados.');
    const text = rawInput.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const inline = [...text.matchAll(/\[([^\[\]\n]+)\]/g)]; // eslint-disable-line no-useless-escape
    const candidates = inline.length ? inline.map((match) => match[1]) : text.split(/\r?\n/).filter((line) => line.trim());
    if (candidates.length > LIMITS.results) throw new Error(`Use no máximo ${LIMITS.results} expressões por mensagem.`);
    const requests = [];
    for (const candidate of candidates) {
        try {
            const request = parseRollExpression(candidate);
            if (strict || request.baseDice > 0 || request.operations > 0 || request.repeat > 1) requests.push(request);
        } catch (error) {
            const looksLikeRoll = /^(?:\d*d(?:\d|f)|[BGW]\d|\d+#|\()/i.test(candidate.trim());
            if (strict && (!inline.length || looksLikeRoll)) throw error;
        }
    }
    const totalResults = requests.reduce((total, request) => total + request.repeat, 0);
    const baseDraws = requests.reduce((total, request) => total + request.baseDice * request.repeat, 0);
    if (totalResults > LIMITS.results) throw new Error(`Use no máximo ${LIMITS.results} resultados por mensagem.`);
    if (baseDraws > LIMITS.draws) throw new Error(`Use no máximo ${LIMITS.draws} dados no total.`);
    return requests;
}

function makeValue(value, values, detail) {
    safeNumber(value);
    return { value, values, detail };
}

function drawPool(node, context) {
    const rolls = [];
    const drawChain = () => {
        const chain = [];
        let value;
        do {
            if (context.draws >= LIMITS.draws) throw new Error(`Limite de ${LIMITS.draws} sorteios atingido; reduza os dados ou as explosões.`);
            context.draws += 1;
            value = rollDie(node.sides, context.randomInteger);
            chain.push(node.fate ? value - 2 : value);
        } while (node.modifiers.explode !== null && value >= node.modifiers.explode);
        return chain;
    };
    for (let i = 0; i < node.count; i += 1) rolls.push(...drawChain());
    if (node.modifiers.aro && rolls.every((value) => value === rolls[0])) {
        const target = rolls[0];
        let matches = true;
        while (matches) {
            const extra = drawChain();
            rolls.push(...extra);
            matches = extra.every((value) => value === target);
        }
    }
    const augmented = rolls.map((value) => ({ value, kept: true }));
    const sorted = [...augmented].sort((a, b) => b.value - a.value);
    const selection = node.modifiers.keep;
    if (selection) {
        sorted.forEach((item, index) => {
            const n = selection.amount;
            if (selection.mode === 'kh') item.kept = index < n;
            if (selection.mode === 'kl') item.kept = index >= sorted.length - n;
            if (selection.mode === 'dh') item.kept = index >= n;
            if (selection.mode === 'dl') item.kept = index < sorted.length - n;
        });
    }
    const values = sorted.filter((item) => item.kept).map((item) => item.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    const order = node.modifiers.noSort || node.modifiers.aro ? augmented : sorted;
    const details = order.slice(0, 30).map((item) => {
        let text = node.fate ? ({ '-1': '−', 0: '0', 1: '+' })[item.value] : String(item.value);
        if (!node.fate && (item.value === 1 || item.value >= (node.modifiers.crit ?? node.sides))) text = `**${text}**`;
        return item.kept ? text : `~~${text}~~`;
    });
    if (order.length > 30) details.push(`… +${order.length - 30} dados`);
    let result = makeValue(total, values, `[${details.join(', ')}] ${node.notation}`);
    if (node.shadow) {
        const threshold = { B: 4, G: 3, W: 2 }[node.shadow];
        const successes = values.filter((value) => value >= threshold).length;
        result = makeValue(successes, [successes], `${result.detail} >> ${threshold}`);
    }
    context.pools.push({ notation: node.notation, rolls: augmented.map((item) => ({ ...item })) });
    return result;
}

function evaluateNode(node, context) {
    if (node.type === 'number') return makeValue(node.value, [node.value], numberFormatter.format(node.value));
    if (node.type === 'dice') return drawPool(node, context);
    if (node.type === 'group') {
        const inner = evaluateNode(node.argument, context);
        return { ...inner, detail: `(${inner.detail})` };
    }
    if (node.type === 'unary' || node.type === 'percent') {
        const inner = evaluateNode(node.argument, context);
        let factor = node.operator === '-' ? -1 : 1;
        if (node.type === 'percent') factor = 0.01;
        return makeValue(
            inner.value * factor,
            inner.values.map((value) => safeNumber(value * factor)),
            node.type === 'percent' ? `${inner.detail}%` : `${node.operator}${inner.detail}`,
        );
    }
    const left = evaluateNode(node.left, context);
    const right = evaluateNode(node.right, context);
    const op = node.operator;
    const detail = `${left.detail} ${op === 'x' || op === 'X' || op === '*' ? '×' : op} ${right.detail}`;
    if (node.type === 'comparison') {
        const comparisons = {
            '<': () => left.value < right.value,
            '<=': () => left.value <= right.value,
            '>': () => left.value > right.value,
            '>=': () => left.value >= right.value,
            '=': () => left.value === right.value,
            '==': () => left.value === right.value,
        };
        const value = comparisons[op]();
        return { value, values: [value ? 1 : 0], detail };
    }
    if (op === '<<' || op === '>>') {
        const count = left.values.filter((value) => (op === '<<' ? value <= right.value : value >= right.value)).length;
        return makeValue(count, [count], detail);
    }
    const relativePercent = (op === '+' || op === '-') && node.right.type === 'percent';
    const amount = relativePercent ? right.value * left.value : right.value;
    if (op === '+') return makeValue(left.value + amount, [...left.values, ...(relativePercent ? [amount] : right.values)], detail);
    if (op === '-') return makeValue(left.value - amount, [...left.values, -amount], detail);
    if (op === '++' || op === '--') {
        const values = left.values.map((value) => safeNumber(value + (op === '++' ? amount : -amount)));
        return makeValue(values.reduce((sum, value) => sum + value, 0), values, detail);
    }
    if (['*', 'x', 'X', '×'].includes(op)) {
        return makeValue(left.value * amount, left.values.map((value) => safeNumber(value * amount)), detail);
    }
    if (amount === 0) throw new Error('Não é possível dividir por zero.');
    return makeValue(left.value / amount, left.values.map((value) => safeNumber(value / amount)), detail);
}

function renderResults(results) {
    const line = (result, compact = false) => {
        let value = numberFormatter.format(result.value);
        if (typeof result.value === 'boolean') value = result.value ? 'SUCESSO' : 'FALHA';
        const expression = compact ? escapeText(result.expression.slice(0, 60)) : result.detail;
        return `\` ${value} \` ⟵ ${expression}${result.label ? ` • ${escapeText(result.label.slice(0, 100))}` : ''}`;
    };
    let content = results.map((result) => line(result)).join('\n');
    if (content.length <= LIMITS.output) return content;
    content = results.map((result) => line(result, true)).join('\n');
    if (content.length <= LIMITS.output) return content;
    const allowance = Math.floor((LIMITS.output - 55) / results.length) - 1;
    const summary = results.map((result) => line({ ...result, label: '' }, true).slice(0, allowance)).join('\n');
    return `${summary}\n*Detalhes resumidos para caber na mensagem.*`;
}

function rollMessage(rawInput, randomInteger = randomInt, { chat = false } = {}) {
    const requests = extractRollRequests(rawInput, !chat);
    if (!requests.length) throw new Error('Nenhuma expressão de rolagem encontrada.');
    const context = { draws: 0, randomInteger, pools: [] };
    const results = [];
    for (const request of requests) {
        for (let i = 0; i < request.repeat; i += 1) {
            const poolStart = context.pools.length;
            const result = evaluateNode(request.tree, context);
            results.push({
                ...result, expression: request.expression, label: request.label, pools: context.pools.slice(poolStart),
            });
        }
    }
    return { results, draws: context.draws, content: renderResults(results) };
}

function isDiceExpression(rawInput) {
    try {
        return extractRollRequests(rawInput, false).length > 0;
    } catch {
        return false;
    }
}

module.exports = {
    LIMITS,
    parseRollExpression,
    extractRollRequests,
    rollDie,
    rollMessage,
    isDiceExpression,
    rollExpression: (rawInput, randomInteger = randomInt) => rollMessage(rawInput, randomInteger).content,
    rollChatExpression: (rawInput, randomInteger = randomInt) => rollMessage(rawInput, randomInteger, { chat: true }).content,
};
