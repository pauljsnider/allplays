import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDir);
const generatedConfigPath = join(repositoryRoot, '.firebase-local.generated.json');

export function buildLocalFirebaseConfig(sourceConfig) {
    const config = structuredClone(sourceConfig);
    const hosting = config.hosting || {};
    const headers = Array.isArray(hosting.headers) ? hosting.headers : [];
    const globalHeaders = headers.find((entry) => entry?.source === '**');

    if (globalHeaders) {
        const values = Array.isArray(globalHeaders.headers) ? globalHeaders.headers : [];
        const cacheHeader = values.find((header) => String(header?.key || '').toLowerCase() === 'cache-control');
        if (cacheHeader) cacheHeader.value = 'no-store';
        else values.push({ key: 'Cache-Control', value: 'no-store' });
        globalHeaders.headers = values;
    } else {
        headers.unshift({
            source: '**',
            headers: [{ key: 'Cache-Control', value: 'no-store' }]
        });
    }

    headers.forEach((entry) => {
        if (entry?.source !== '**/*.@(js|css)') return;
        (entry.headers || []).forEach((header) => {
            if (String(header?.key || '').toLowerCase() === 'cache-control') {
                header.value = 'no-store';
            }
        });
    });
    hosting.headers = headers;
    config.hosting = hosting;
    return config;
}

export function startLocalFirebaseHosting(projectId = 'game-flow-c6311') {
    const sourceConfig = JSON.parse(readFileSync(join(repositoryRoot, 'firebase.json'), 'utf8'));
    const localConfig = buildLocalFirebaseConfig(sourceConfig);
    writeFileSync(generatedConfigPath, `${JSON.stringify(localConfig, null, 2)}\n`);

    const child = spawn('firebase', [
        'emulators:start',
        '--only',
        'hosting',
        '--project',
        projectId,
        '--config',
        generatedConfigPath
    ], {
        cwd: repositoryRoot,
        stdio: 'inherit'
    });

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try { unlinkSync(generatedConfigPath); } catch { /* already removed */ }
    };
    const forwardSignal = (signal) => {
        if (!child.killed) child.kill(signal);
    };
    process.once('SIGINT', () => forwardSignal('SIGINT'));
    process.once('SIGTERM', () => forwardSignal('SIGTERM'));
    child.once('error', (error) => {
        cleanup();
        console.error('Unable to start the Firebase Hosting emulator:', error.message);
        process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
        cleanup();
        process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
    });
    return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startLocalFirebaseHosting(String(process.argv[2] || 'game-flow-c6311'));
}
