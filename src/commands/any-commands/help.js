const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
    buildCarouselControls,
    registerCarousel,
} = require('../../handlers/carouselInteractionHandler');
const { isBotOwner } = require('../../utils/botOwners');

const OWNER_AUDIO_HELP = [
    '`/uploadaudio` — Envia um áudio; restrito aos donos do bot.',
    '`/ytmp3` — Salva um áudio do YouTube; restrito aos donos do bot.',
].join('\n');

const HELP_PAGES = [
    {
        id: 'inicio',
        title: '🏰 Guia de Gideon',
        description: [
            'Gideon reúne música, dados e um minigame de coleção para campanhas de RPG.',
            '',
            '**Progressão automática**',
            'Ações no bot concedem XP e Renome.',
            'Perfis, moedas, cartas e estoques são separados por servidor.',
            '',
            '**Como navegar**',
            'Use `◀️` e `▶️` para folhear este guia.',
            '',
            '`/help` — Abre novamente este manual.',
        ].join('\n'),
    },
    {
        id: 'perfil',
        title: '🛡️ Perfil e economia',
        description: [
            '`/perfil` — Exibe sua ficha, nível, moedas, Renome e coleção.',
            '`/customizar` — Altera cor, título, lema e brasão da ficha.',
            '`/daily` — Resgata a recompensa diária de moedas.',
            '`/pagar` — Transfere moedas para outro jogador.',
            '`/mercador` — Compra melhorias, consumíveis e pacotes.',
            '',
            'Cada oferta recebe **1 a 6 unidades por servidor**.',
            'O mercador renova o estoque à **00:00**, no horário de Brasília.',
        ].join('\n'),
    },
    {
        id: 'colecao',
        title: '🃏 Coleção de cartas',
        description: [
            '`/codice` — Mostra todas as cartas existentes no jogo.',
            '`/pack` — Abre duas cartas e um Coringa cerimonial.',
            'Chance de magia por raridade: **Básico 12–40% • Arcano 28–55% • Grimório 100%**.',
            'As demais categorias disponíveis dividem igualmente a chance de cada raridade.',
            '`/cartas` — Folheia todas as cópias do seu álbum.',
            '`/carta ver` — Examina uma cópia pelo número de série.',
            '',
            '**Float** define o estado e o valor de cada exemplar.',
            'Quanto menor, mais conservada e valiosa é a carta.',
        ].join('\n'),
    },
    {
        id: 'cartas',
        title: '⚒️ Gerenciar cartas',
        description: [
            '`/carta descrever` — Usa um pergaminho para escrever na carta.',
            '`/carta casar` — Usa um anel e protege a carta com um vínculo.',
            '`/carta organizar` — Define a ordem padrão do álbum.',
            '`/combinar` — Consome duas cópias e tenta melhorar a raridade.',
            '`/tradecard` — Propõe uma troca entre dois jogadores.',
            '`/vendercarta` — Vende uma cópia pelo valor de seu Float.',
            '',
            'Cartas casadas não podem ser vendidas, trocadas ou combinadas.',
        ].join('\n'),
    },
    {
        id: 'musica',
        title: '🎶 Música e áudios',
        description: [
            '`/play` — Toca músicas e playlists de YouTube, Spotify e SoundCloud.',
            '`/soundpad` — Reproduz trilhas e efeitos simultâneos, com volume próprio para cada camada.',
            '',
            'Os players possuem fila, pausa, pular, voltar e loop.',
            'No **Pergaminho** do /play, navegue pela fila e escolha uma faixa para tocar agora.',
            'As outras músicas mantêm a ordem; a faixa interrompida fica no histórico.',
            'Também controlam volume e encerramento automático.',
            '',
            '`/play` e `/soundpad` são exclusivos.',
            'Quando um está ativo no servidor, o outro fica bloqueado.',
        ].join('\n'),
    },
    {
        id: 'dados',
        title: '🎲 Dados • Rolagens de Gideon',
        description: [
            'Funciona no `/roll` e diretamente no chat.',
            '`1d20+7 ataque` — Dado com modificador e descrição.',
            '`(2d6+3)*2` — Operações e parênteses.',
            '`2d20kh1` / `2d20kl1` — Vantagem / desvantagem.',
            '`4d6kh3` ou `4d6d1` — Mantém os 3 maiores / descarta o menor.',
            '`4d6kl2`, `4d6dh1`, `4d6dl1` — Mantém menores ou descarta maiores/menores.',
            '`6#4d6kh3` — Repete para gerar atributos.',
            '`Ataque [d20+7] e dano [2d6+3]` — Várias rolagens na mensagem.',
            '`1d20+50%` / `85+50%` — Porcentagens do Gideon.',
            '',
            'Descartes aparecem ~~riscados~~. Use `ns` para manter a ordem dos sorteios.',
        ].join('\n'),
    },
    {
        id: 'dados-avancados',
        title: '🎲 Dados • Sistemas e modificadores',
        description: [
            '`d6!` / `d6!5` — Explode no máximo / a partir de 5.',
            '`4d6++2` / `4d6--2` — Soma/subtrai 2 em cada dado.',
            '`10d6 >> 4` / `10d6 << 3` — Conta valores ≥ 4 / ≤ 3.',
            '`1d20+7 >= 15` — Compara o total; retorna SUCESSO ou FALHA.',
            'Comparações: `<`, `<=`, `>`, `>=`, `=`, `==`, sempre no final.',
            '`4dF` — Dados Fate: −1, 0 e +1.',
            '`B5`, `G5`, `W5` — Burning Wheel: sucessos a partir de 4, 3 e 2.',
            '`B5!` — Burning Wheel com explosões.',
            '`2d6daro`, `3d6taro`, `4d6aro` — Dados iguais podem gerar novos sorteios.',
            '`4d20c19` — Destaca valores a partir de 19; não combina com keep/drop.',
            '`4d6ns` — Mostra a ordem original dos dados.',
            '',
            'Limites: **100 dados por termo, 20 resultados e 1.000 sorteios por mensagem**, incluindo explosões.',
            'Detalhes longos são resumidos, mantendo os totais.',
        ].join('\n'),
    },
    {
        id: 'utilidades',
        title: '🎲 Dados e administração',
        description: [
            '`/roll` — Rola dados ou calcula expressões matemáticas.',
            '`1d20+7`, `1d20+50%` ou `10x10+78` no chat — Detecta e resolve automaticamente.',
            '`/ping` — Mostra se Gideon está respondendo.',
            '`/clear` — Limpa mensagens; exige Gerenciar Mensagens.',
            '`/audiosize` — Informa o espaço ocupado pelos áudios.',
            '`/emoji` — Gerencia emojis; disponível somente ao dono do bot.',
        ].join('\n'),
    },
];

function getHelpPages(userId) {
    if (!isBotOwner(userId)) return HELP_PAGES;
    return HELP_PAGES.map((page) => (page.id === 'utilidades'
        ? { ...page, description: `${page.description}\n${OWNER_AUDIO_HELP}` }
        : page));
}

function createHelpEmbed(position, pages = HELP_PAGES) {
    const page = pages[position];
    return new EmbedBuilder()
        .setColor(0x8B1E2D)
        .setAuthor({ name: '📜 MANUAL DO AVENTUREIRO' })
        .setTitle(page.title)
        .setDescription(page.description)
        .setFooter({ text: `${position + 1}/${pages.length} • /help` });
}

function createHelpPayload(position, pages = HELP_PAGES) {
    return {
        embeds: [createHelpEmbed(position, pages)],
        components: [buildCarouselControls(position, pages.length)],
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Mostra todas as funções e comandos de Gideon.')
        .addStringOption((option) => option
            .setName('categoria')
            .setDescription('Abre o manual diretamente em uma categoria.')
            .addChoices(...HELP_PAGES.map((page) => ({
                name: page.title,
                value: page.id,
            }))))
        .setDMPermission(false),

    async execute(interaction) {
        const pages = getHelpPages(interaction.user.id);
        const category = interaction.options.getString('categoria');
        const selected = pages.findIndex((page) => page.id === category);
        const position = selected >= 0 ? selected : 0;
        const render = (nextPosition) => createHelpPayload(nextPosition, pages);

        await interaction.reply(render(position));
        await registerCarousel(interaction, {
            position,
            total: pages.length,
            render,
        });
        return undefined;
    },

    HELP_PAGES,
    createHelpEmbed,
    createHelpPayload,
    getHelpPages,
};
