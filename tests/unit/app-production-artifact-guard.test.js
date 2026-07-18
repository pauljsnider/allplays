import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    assertSafeProductionBundle,
    assertSafeProductionDist,
    assertSafeProductionModuleGraph,
    createProductionArtifactGuard
} from '../../apps/app/build/productionArtifactGuard.js';

const temporaryDirectories = [];

function makeTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'allplays-app-artifact-'));
    temporaryDirectories.push(directory);
    return directory;
}

function writeFile(rootDirectory, relativePath, contents = '') {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('app production artifact guard', () => {
    it('allows only app, legacy bridge, and dependency modules from inside the repository', () => {
        const repoRoot = path.resolve('/workspace/allplays');
        const appDirectory = path.join(repoRoot, 'apps/app');

        expect(() => assertSafeProductionModuleGraph([
            path.join(appDirectory, 'src/main.tsx'),
            path.join(repoRoot, 'js/firebase-runtime-config.js'),
            path.join(repoRoot, 'node_modules/react/index.js'),
            '\0vite/preload-helper.js'
        ], { appDirectory, repoRoot })).not.toThrow();
    });

    it('rejects a repository-root module even when Vite would inline it', () => {
        const repoRoot = path.resolve('/workspace/allplays');
        const appDirectory = path.join(repoRoot, 'apps/app');

        expect(() => assertSafeProductionModuleGraph([
            path.join(appDirectory, 'src/main.tsx'),
            `${path.join(repoRoot, 'AGENTS.md')}?url`
        ], { appDirectory, repoRoot })).toThrow(/AGENTS\.md/);
    });

    it('rejects emitted repository documents and inlined root-glob maps', () => {
        expect(() => assertSafeProductionBundle({
            'index.html': { type: 'asset', source: '<div id="root"></div>' },
            'assets/index.css': { type: 'asset', source: 'body{}' },
            'assets/index.js': { type: 'chunk', code: 'console.log("ok")' },
            'assets/AGENTS-deadbeef.md': { type: 'asset', source: '# Repository Guidelines' }
        })).toThrow(/AGENTS-deadbeef\.md/);

        expect(() => assertSafeProductionBundle({
            'index.html': { type: 'asset', source: '<div id="root"></div>' },
            'assets/index.css': { type: 'asset', source: 'body{}' },
            'assets/index.js': {
                type: 'chunk',
                code: 'const files = Object.assign({"../AGENTS.md":"data:text/plain;base64,AAAA"});'
            }
        })).toThrow(/repository-root glob map/);
    });

    it('verifies final disk output against public files and rejects credential content', () => {
        const rootDirectory = makeTemporaryDirectory();
        const distDirectory = path.join(rootDirectory, 'dist');
        const publicDirectory = path.join(rootDirectory, 'public');
        writeFile(publicDirectory, 'logo.png', 'public-image');
        writeFile(distDirectory, 'index.html', '<div id="root"></div>');
        writeFile(distDirectory, 'assets/index.js', 'console.log("ok")');
        writeFile(distDirectory, 'assets/index.css', 'body{}');
        writeFile(distDirectory, 'logo.png', 'public-image');

        expect(assertSafeProductionDist(distDirectory, { publicDirectory })).toMatchObject({
            fileCount: 4,
            javascriptCount: 1,
            cssCount: 1,
            publicFileCount: 1
        });

        writeFile(distDirectory, 'assets/secret.js', 'const leaked = "-----BEGIN PRIVATE KEY-----";');
        expect(() => assertSafeProductionDist(distDirectory, { publicDirectory }))
            .toThrow(/private key material/);
    });

    it('verifies the resolved Vite output directory from the post-write hook', () => {
        const repoRoot = makeTemporaryDirectory();
        const appDirectory = path.join(repoRoot, 'apps/app');
        const customOutDirectory = path.join(repoRoot, 'custom-build-output');
        writeFile(customOutDirectory, 'index.html', '<div id="root"></div>');
        writeFile(customOutDirectory, 'assets/index.js', 'console.log("ok")');
        writeFile(customOutDirectory, 'assets/index.css', 'body{}');

        const plugin = createProductionArtifactGuard({ appDirectory, repoRoot });
        plugin.configResolved({
            root: appDirectory,
            build: { outDir: customOutDirectory },
            publicDir: false
        });

        expect(plugin.closeBundle).toBeUndefined();
        expect(() => plugin.writeBundle()).not.toThrow();
    });
});
