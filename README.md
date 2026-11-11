# O melhor bot para sua mesa de RPG

## Gideon the Bard

```text
┏┓• ┓        ┏┳┓┓     ┓      ┓
┃┓┓┏┫┏┓┏┓┏┓   ┃ ┣┓┏┓  ┣┓┏┓┏┓┏┫
┗┛┗┗┻┗ ┗┛┛┗   ┻ ┛┗┗   ┗┛┗┻┛ ┗┻
```

Gideon é um bot multitarefa para Discord criado para acompanhar campanhas de RPG. Ele reúne música, soundboard, rolagem de dados, progressão por servidor, economia e um minigame de cartas colecionáveis.

## Recursos principais

- Música e playlists de YouTube, Spotify e SoundCloud em uma fila unificada.
- Player interativo com pausa, avanço, retorno, loop e volume.
- Encerramento manual do soundpad com desconexão e remoção automática do painel.
- Soundboard organizado por categorias para SoundEffects, músicas e trilhas locais.
- Origem do áudio exibida no soundpad; uploads são agrupados em **Outros**.
- Rolagem segura de dados e cálculo automático de expressões solitárias no chat.
- XP, níveis, Renome e moedas concedidos pelas ações realizadas no bot.
- Perfis, inventários e economia independentes em cada servidor.
- Mercador com estoque diário aleatório de 1 a 6 unidades por oferta e servidor.
- Cartas de classes, raças, terrenos, personagens, divindades e magias.
- Exemplares únicos identificados por número de série, raridade e **Float**.
- Álbuns, pacotes, combinações, trocas, vendas, descrições e casamento de cartas.
- Menus e carrosséis centralizados para respostas rápidas.
- Registro de erros em `logs/log.txt`, com remoção automática de credenciais.
- Status personalizado rotativo e painel medieval no terminal.

## Comandos

### Música e áudio

| Comando | Função |
| --- | --- |
| `/play` | Reproduz uma música, busca ou playlist de YouTube, Spotify ou SoundCloud. |
| `/soundpad` | Abre o catálogo de áudios locais por categoria, com trilha e efeitos simultâneos e volumes independentes. |
| `/uploadaudio` | Adiciona um arquivo ao soundboard; restrito aos donos do bot. |
| `/ytmp3` | Baixa áudios de até 2 horas e 100 MB do YouTube; restrito aos donos do bot. |
| `/audiosize` | Mostra o espaço utilizado pelo catálogo local. |

`/play` e `/soundpad` são mutuamente exclusivos em cada servidor: enquanto um player estiver ativo, o outro ficará bloqueado. O bot encerra a sessão e o menu quando a fila fica inativa ou não existem mais usuários no canal de voz.

A fila do `/play` aceita até 1.000 faixas no total. O histórico do botão anterior conserva as últimas 100 faixas.

No botão **Pergaminho**, navegue pelas páginas e selecione uma música para tocar imediatamente. Ela sai da posição antiga, a faixa interrompida vai para o histórico e as demais continuam na mesma ordem. A seleção toca uma vez antes de retomar o restante, mesmo com o loop de uma faixa ativado.

### RPG, perfil e economia

| Comando | Função |
| --- | --- |
| `/roll` | Rola dados ou calcula uma expressão matemática. |
| Expressão no chat | Detecta rolagens, descrições e expressões inline, como `1d20+7 ataque` ou `Ataque [d20] e dano [2d6]`. |
| `/perfil` | Exibe a ficha, nível, XP, moedas, Renome e resumo da coleção. |
| `/customizar` | Personaliza cor, título, lema e brasão do perfil. |
| `/daily` | Recebe a recompensa diária. |
| `/pagar` | Transfere moedas para outro jogador do servidor. |
| `/mercador` | Abre as alas de itens de perfil e de cartas. |

O mercador renova seu estoque à **00:00 no horário de Brasília**. Cada oferta recebe de **1 a 6 unidades** naquele servidor e fica indisponível quando todas forem compradas.

### Motor de dados do Gideon

O `/roll` e a detecção no chat compartilham o mesmo interpretador de expressões. Os sorteios usam `crypto.randomInt`. O texto da descrição deve vir separado da expressão por um espaço.

| Expressão | Função |
| --- | --- |
| `1d20+7 ataque` | Dado, modificador e descrição. |
| `(2d6+3)*2` | Operações com prioridade e parênteses; aceita também `x`, `×` e `÷`. |
| `2d20kh1` / `2d20kl1` | Mantém o maior / menor resultado: vantagem e desvantagem. |
| `4d6k3` / `4d6kh3` | Mantém os três maiores dados. |
| `4d6kl2` | Mantém os dois menores dados. |
| `4d6d1` / `4d6dl1` / `4d6dh1` | Descarta o menor / menor / maior dado. |
| `6#4d6kh3` | Avalia a rolagem seis vezes. |
| `d6!` / `d6!5` | Explode no valor máximo / a partir de 5. As explosões geram dados adicionais. |
| `4d6ns` | Desativa a ordenação da exibição; o padrão é do maior para o menor. |
| `4d6++2` / `4d6--2` | Modifica cada dado individualmente. |
| `10d6 >> 4` / `10d6 << 3` | Conta os valores maiores ou iguais a 4 / menores ou iguais a 3. |
| `1d20+7 >= 15` | Compara o resultado. Aceita `<`, `<=`, `>`, `>=`, `=` e `==` no final da expressão. |
| `4dF` | Fate/Fudge: quatro dados com valores −1, 0 e +1. |
| `B5` / `G5` / `W5` | Burning Wheel: cinco d6, contando sucessos nos limiares 4 / 3 / 2. Aceita `!`. |
| `2d6daro` / `3d6taro` / `4d6aro` | Dados iniciais iguais geram dados adicionais enquanto o valor se repete. |
| `4d20c19` | Destaca a faixa crítica a partir de 19. Não combina com manter/descartar. |
| `Ataque [d20+7] e dano [2d6+3]` | Avalia várias expressões inline em uma única resposta. |
| `1d20+50%` / `85+50%` | Extensão do Gideon: soma 50% ao subtotal, preservando o comportamento anterior. |

Os dados descartados aparecem riscados; mínimos, máximos e a faixa crítica recebem destaque. Conversas comuns, números soltos e exemplos dentro de código não ativam o bot. Expressões explícitas inválidas no `/roll` recebem uma explicação.

Limites por mensagem: **20 resultados**, **1.000 sorteios no total**, até **100 dados por termo** e **100.000 faces por dado**. Expressões possuem até 500 caracteres e 32 níveis de aninhamento. As explosões e o ARO compartilham o mesmo orçamento de sorteios e não podem criar ciclos infinitos. Quando necessário, a resposta resume os detalhes para caber no Discord sem perder os totais.

### Coleção de cartas

| Comando | Função |
| --- | --- |
| `/pack` | Abre duas cartas colecionáveis e um Coringa cerimonial não contabilizado. |
| `/cartas` | Percorre em carrossel todas as cartas de um jogador. |
| `/carta ver` | Mostra todos os detalhes de um exemplar. |
| `/carta descrever` | Usa um pergaminho para adicionar uma descrição pessoal. |
| `/carta casar` | Usa um anel para criar um vínculo com a carta. |
| `/carta organizar` | Define a ordem padrão do álbum. |
| `/codice` | Mostra todas as cartas existentes no jogo, com filtros. |
| `/combinar` | Consome duas cópias e tenta melhorar a raridade ou rerrolar o Float. |
| `/tradecard` | Propõe uma troca de cartas entre jogadores. |
| `/vendercarta` | Vende um exemplar ao mercador pelo valor calculado. |

Cada cópia possui um **Float** próprio. Quanto menor o Float, melhor é o estado de conservação e maior tende a ser o valor. Cartas casadas ficam protegidas e não podem ser vendidas, trocadas ou combinadas.

Os pacotes possuem probabilidades próprias por categoria e raridade. Pacotes especializados aumentam a chance de obter cartas do tema correspondente sem eliminar o equilíbrio geral da coleção.

### Utilidades e administração

| Comando | Função |
| --- | --- |
| `/help` | Abre o manual completo do Gideon por categorias. |
| `/ping` | Verifica se o bot está respondendo. |
| `/clear` | Apaga mensagens recentes. Requer **Gerenciar Mensagens**. |
| `/emoji` | Lista, envia ou apaga emojis da aplicação; restrito ao dono do bot. |

## Requisitos

- [Node.js](https://nodejs.org/) 22.12 ou superior.
- Uma aplicação configurada no [Discord Developer Portal](https://discord.com/developers/applications).
- Uma instância do MongoDB, local ou no MongoDB Atlas.
- No Windows, permissão para executar o `yt-dlp.exe` incluído no projeto.
- Credenciais da API do Spotify são recomendadas para playlists e metadados completos.

No Developer Portal, habilite o intent **Message Content** para permitir a detecção automática de expressões de dados no chat. Na instalação do app, mantenha os escopos `bot` e `applications.commands`.

## Instalação

```powershell
# Entre na pasta do projeto
cd Bot

# Instale as dependências
npm install

# Publique os slash commands globais
npm run deploy:commands

# Inicie o Gideon
npm start
```

O processo normal de inicialização não republica os comandos. Execute `npm run deploy:commands` quando adicionar, remover ou modificar a definição de um slash command.

No Windows, depois de instalar as dependências e configurar o `.env`, dê dois cliques em **Iniciar Gideon.vbs** para rodar o bot sem janela de terminal. Consulte `logs/log.txt` para erros do bot e `logs/inicializador.txt` para a saída de erro do processo na inicialização.

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```dotenv
TOKEN=token_do_bot
CLIENT_ID=id_da_aplicacao
MONGO_URI=mongodb+srv://usuario:senha@cluster/banco

# Opcionais
APPLICATION_ID=id_da_aplicacao
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
CUSTOM_DNS=true
YOUTUBE_COOKIES_BROWSER=edge:Default
YOUTUBE_YTDLP_PATH=
```

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `TOKEN` | Sim | Token de autenticação do bot. |
| `CLIENT_ID` | Sim | ID da aplicação usado para publicar os comandos. |
| `MONGO_URI` | Sim | String de conexão do MongoDB. |
| `APPLICATION_ID` | Não | ID usado pelo gerenciador de emojis; usa a aplicação conectada como alternativa. |
| `SPOTIFY_CLIENT_ID` | Não | Client ID da API oficial do Spotify. |
| `SPOTIFY_CLIENT_SECRET` | Não | Client secret da API oficial do Spotify. |
| `CUSTOM_DNS` | Não | `true` força DNS público; `false` desativa o fallback de DNS do MongoDB. |
| `YOUTUBE_COOKIES_BROWSER` | Não | Navegador e perfil usados para exportar cookies. Padrão: `edge:Default`. |
| `YOUTUBE_YTDLP_PATH` | Não | Caminho alternativo para o executável do yt-dlp. |
| `NO_COLOR` | Não | Desativa as cores ANSI do painel do terminal. |

Nunca publique `.env`, tokens, credenciais do MongoDB ou cookies do navegador. Esses arquivos já estão cobertos pelo `.gitignore` do projeto.

## Vídeos com restrição de idade

Faça login no YouTube pelo navegador configurado, feche-o completamente e execute:

```powershell
npm run cookies:youtube
```

O comando mantém somente cookies dos domínios YouTube e Google e grava o resultado em `src/commands/commands-audios/cookies.txt`. O arquivo é local e não será enviado ao Git.

Se o Windows bloquear o executável, abra as propriedades de `src/commands/commands-audios/yt-dlp.exe`, marque **Desbloquear** e aplique a alteração.

## Scripts de desenvolvimento

| Script | Função |
| --- | --- |
| `npm start` | Inicia o bot. |
| `npm run dev` | Inicia com reinicialização automática pelo Nodemon. |
| `npm run deploy:commands` | Publica a lista atual de slash commands globais. |
| `npm run validate` | Valida carregamento, nomes duplicados e estrutura dos comandos. |
| `npm run lint` | Executa o ESLint no projeto. |
| `npm run cookies:youtube` | Atualiza os cookies locais utilizados pelo yt-dlp. |

Antes de enviar alterações ao Git:

```powershell
npm run validate
npm run lint
```

## Diagnóstico

- Erros de execução são gravados em `logs/log.txt`.
- Segredos conhecidos são substituídos por `[SEGREDO_REMOVIDO]` antes da gravação.
- Se o MongoDB retornar `querySrv ECONNREFUSED`, o bot tenta novamente com DNS público, exceto quando `CUSTOM_DNS=false`.
- Falhas HTTP 5xx, de rede ou do Gateway durante o login no Discord são repetidas automaticamente.
- Falhas temporárias de transmissão podem ser recuperadas pelo motor de música; somente erros relevantes devem chegar ao log.

## Estrutura resumida

```text
Bot/
├── app.js                       # Inicialização, MongoDB e handlers globais
├── config.js                    # Validação das credenciais principais
├── slashBuilder.js              # Publicação dos slash commands
├── scripts/                     # Validação e cookies do YouTube
├── logs/                        # Registro local de erros
└── src/
    ├── assets/cards/            # Artes das cartas
    ├── commands/                # Comandos de RPG, áudio e música
    ├── events/                  # Eventos do Discord
    ├── handlers/                # Botões, carrosséis e sessões
    ├── models/                  # Modelos MongoDB
    └── utils/                   # Catálogo, DNS, logs e perfis
```

## Licença

Distribuído sob a licença ISC.
