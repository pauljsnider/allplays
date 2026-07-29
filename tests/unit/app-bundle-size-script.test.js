import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];

afterEach(() => {
    tempDirs.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('app cold-start bundle budget', () => {
    it('recursively counts minified static imports in file and gzip totals', () => {
        const distDir = mkdtempSync(path.join(tmpdir(), 'allplays-app-budget-'));
        tempDirs.push(distDir);
        mkdirSync(path.join(distDir, 'assets'));
        writeFileSync(
            path.join(distDir, 'index.html'),
            '<script type="module" src="./assets/index-fixture.js"></script>'
        );
        writeFileSync(
            path.join(distDir, 'assets', 'index-fixture.js'),
            'import"./setup.js";export{x}from"./chunk.js";'
        );
        writeFileSync(
            path.join(distDir, 'assets', 'setup.js'),
            'import"./nested.js";export const setup="abcdefghijklmnopqrstuvwxyz0123456789";'
        );
        writeFileSync(
            path.join(distDir, 'assets', 'chunk.js'),
            'export const x="ABCDEFGHIJKLMNOPQRSTUVWXYZ9876543210";'
        );
        writeFileSync(
            path.join(distDir, 'assets', 'nested.js'),
            'export const nested="qwertyuiopasdfghjklzxcvbnm2468013579";'
        );

        const result = spawnSync(
            process.execPath,
            ['scripts/check-app-bundle-size.mjs'],
            {
                cwd: path.resolve(import.meta.dirname, '../..'),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    APP_DIST_DIR: distDir,
                    APP_ENTRY_CHUNK_LIMIT_BYTES: '10000',
                    APP_INITIAL_GZIP_LIMIT_BYTES: '100',
                    APP_INITIAL_FILE_LIMIT: '2',
                    APP_MODULE_PRELOAD_LIMIT: '10'
                }
            }
        );
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain('initial static payload (gzip)');
        expect(output).toContain('initial asset count: 4 files > 2 files');
    });
});
