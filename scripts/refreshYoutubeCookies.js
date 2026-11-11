/* eslint-disable no-console */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const audioCommandsPath = path.join(projectRoot, 'src', 'commands', 'commands-audios');
const bundledYtDlpPath = path.join(audioCommandsPath, 'yt-dlp.exe');
const ytDlpPath = process.env.YOUTUBE_YTDLP_PATH || bundledYtDlpPath;
const cookiesPath = path.join(audioCommandsPath, 'cookies.txt');
const pendingCookiesPath = path.join(audioCommandsPath, 'cookies.pending.txt');
const ageRestrictedTestUrl = 'https://www.youtube.com/watch?v=EDIxTIi9Uzw';
const allowedCookieDomains = ['youtube.com', 'google.com'];
const browserProfile = process.env.YOUTUBE_COOKIES_BROWSER || 'edge:Default';

function removePendingFile() {
    if (fs.existsSync(pendingCookiesPath)) fs.rmSync(pendingCookiesPath, { force: true });
}

function keepYouTubeCookie(line) {
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) return true;
    const cookieLine = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
    const [domain = ''] = cookieLine.split('\t');
    const normalizedDomain = domain.replace(/^\./, '').toLowerCase();
    return allowedCookieDomains.some((allowedDomain) => (
        normalizedDomain === allowedDomain || normalizedDomain.endsWith(`.${allowedDomain}`)
    ));
}

function retainYouTubeCookies() {
    const lines = fs.readFileSync(pendingCookiesPath, 'utf8').split(/\r?\n/);
    const retainedLines = lines.filter(keepYouTubeCookie);
    const cookieCount = retainedLines.filter((line) => (
        line && (!line.startsWith('#') || line.startsWith('#HttpOnly_'))
    )).length;
    if (cookieCount === 0) return false;
    fs.writeFileSync(pendingCookiesPath, `${retainedLines.join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    return true;
}

if (!fs.existsSync(ytDlpPath)) {
    console.error('❌ yt-dlp.exe não foi encontrado na pasta de comandos de áudio.');
    process.exitCode = 1;
} else {
    removePendingFile();
    console.log(`🔐 Lendo os cookies de ${browserProfile}...`);

    const result = spawnSync(ytDlpPath, [
        '--cookies-from-browser', browserProfile,
        '--cookies', pendingCookiesPath,
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--quiet',
        '--print', '%(id)s',
        ageRestrictedTestUrl,
    ], {
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
    });

    const validExport = result.status === 0
        && fs.existsSync(pendingCookiesPath)
        && fs.statSync(pendingCookiesPath).size >= 100;
    const validCookies = validExport && retainYouTubeCookies();

    if (!validCookies) {
        removePendingFile();
        console.error(`❌ Não foi possível exportar os cookies de ${browserProfile}.`);
        console.error('Feche completamente o navegador e execute novamente neste terminal.');
        process.exitCode = 1;
    } else {
        fs.copyFileSync(pendingCookiesPath, cookiesPath);
        removePendingFile();
        console.log('✅ Cookies atualizados e vídeo com restrição de idade autenticado.');
        console.log('🔒 Apenas cookies dos domínios YouTube/Google foram mantidos.');
        console.log('🛡️ O arquivo cookies.txt está protegido pelo .gitignore.');
    }
}
