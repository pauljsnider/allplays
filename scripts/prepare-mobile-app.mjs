import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileDir = path.join(rootDir, 'mobile-lite');

const bundledPages = [
    'parent-dashboard.html',
    'calendar.html',
    'messages.html',
    'team-chat.html'
];

const bundledDirectories = [
    'js',
    'css',
    'img'
];

const appModeHeadMarker = '<meta name="allplays-app-mode" content="1">';
const appModeBootstrapMarker = 'id="allplays-app-mode-bootstrap"';
const appModeBootstrap = `    <link id="allplays-app-mode-stylesheet" rel="stylesheet" href="css/mobile-app.css?v=4">
    <script id="allplays-app-mode-bootstrap">
        (() => {
            window.__ALLPLAYS_FORCE_APP_MODE__ = true;
            try {
                window.sessionStorage?.setItem('allplays-app-mode', '1');
            } catch (_) {}

            document.documentElement.classList.add('allplays-app-document');
            const applyBodyMode = () => {
                document.body?.classList.add('allplays-app-mode', 'allplays-platform-native');
            };

            if (document.body) {
                applyBodyMode();
            } else {
                document.addEventListener('DOMContentLoaded', applyBodyMode, { once: true });
            }
        })();
    </script>`;

async function copyIntoMobile(source) {
    const sourcePath = path.join(rootDir, source);
    const destinationPath = path.join(mobileDir, source);

    await rm(destinationPath, { recursive: true, force: true });
    await cp(sourcePath, destinationPath, {
        recursive: true,
        dereference: true
    });
}

async function forceAppModeForPage(page) {
    const pagePath = path.join(mobileDir, page);
    let html = await readFile(pagePath, 'utf8');

    html = html.replace(/<meta name="viewport" content="([^"]*)">/i, (match, content) => {
        if (content.includes('viewport-fit=cover')) return match;
        return `<meta name="viewport" content="${content}, viewport-fit=cover">`;
    });

    if (!html.includes(appModeHeadMarker)) {
        html = html.replace(/<meta name="viewport"[^>]*>/i, (match) => `${match}\n    ${appModeHeadMarker}`);
    }

    if (!html.includes(appModeBootstrapMarker)) {
        html = html.replace('</head>', `${appModeBootstrap}\n</head>`);
    }

    await writeFile(pagePath, html);
}

await mkdir(mobileDir, { recursive: true });

for (const page of bundledPages) {
    await copyIntoMobile(page);
    await forceAppModeForPage(page);
}

for (const directory of bundledDirectories) {
    await copyIntoMobile(directory);
}
