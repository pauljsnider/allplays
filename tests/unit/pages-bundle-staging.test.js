import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { stagePagesBundle } from '../../scripts/stage-pages-bundle.mjs';
import { writeFirebaseHostingConfig } from '../../scripts/write-firebase-hosting-config.mjs';

const tempDirs = [];

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allplays-pages-bundle-'));
    tempDirs.push(dir);
    return dir;
}

function writeFile(filePath, contents = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

afterEach(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe('pages bundle staging', () => {
    it('does not track dependency install directories in the repository', () => {
        const trackedDependencyDirs = execFileSync('git', [
            'ls-files',
            '--',
            'node_modules',
            'apps/app/node_modules'
        ], {
            cwd: path.resolve(import.meta.dirname, '../..'),
            encoding: 'utf8'
        }).trim();

        expect(trackedDependencyDirs).toBe('');
    });

    it('stages the legacy root and React app without publishing source or config files', () => {
        const rootDir = makeTempDir();
        const destinationDir = path.join(makeTempDir(), 'site');

        writeFile(path.join(rootDir, 'index.html'), '<h1>ALL PLAYS</h1>');
        writeFile(path.join(rootDir, 'css', 'site.css'), 'body {}');
        writeFile(path.join(rootDir, 'js', 'site.js'), 'export const ok = true;');
        writeFile(path.join(rootDir, 'CNAME'), 'allplays.ai');
        writeFile(path.join(rootDir, '.well-known', 'assetlinks.json'), '[]');
        writeFile(path.join(rootDir, '.well-known', 'apple-app-site-association'), '{}');
        writeFile(path.join(rootDir, 'package.json'), '{}');
        writeFile(path.join(rootDir, 'firebase.json'), '{}');
        writeFile(path.join(rootDir, '.firebaserc'), '{}');
        writeFile(path.join(rootDir, 'README.md'), '# private docs');
        writeFile(path.join(rootDir, 'apps', 'app', 'src', 'main.tsx'), 'source');
        writeFile(path.join(rootDir, 'apps', 'app', 'dist', 'index.html'), '<div id="root"></div>');
        writeFile(path.join(rootDir, 'apps', 'app', 'dist', 'assets', 'index.js'), 'console.log("app");');
        writeFile(path.join(rootDir, 'tests', 'unit', 'example.test.js'), 'test');

        const result = stagePagesBundle(destinationDir, { rootDir });

        expect(fs.existsSync(result.rootIndexPath)).toBe(true);
        expect(fs.existsSync(result.appIndexPath)).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, 'css', 'site.css'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, 'js', 'site.js'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, 'CNAME'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, '.well-known', 'assetlinks.json'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, '.well-known', 'apple-app-site-association'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, 'app', 'assets', 'index.js'))).toBe(true);
        expect(fs.existsSync(path.join(destinationDir, '.nojekyll'))).toBe(true);

        expect(fs.existsSync(path.join(destinationDir, 'package.json'))).toBe(false);
        expect(fs.existsSync(path.join(destinationDir, 'firebase.json'))).toBe(false);
        expect(fs.existsSync(path.join(destinationDir, '.firebaserc'))).toBe(false);
        expect(fs.existsSync(path.join(destinationDir, 'README.md'))).toBe(false);
        expect(fs.existsSync(path.join(destinationDir, 'apps', 'app', 'src', 'main.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(destinationDir, 'tests', 'unit', 'example.test.js'))).toBe(false);
    });

    it('writes a Firebase config that points hosting at the staged bundle', () => {
        const rootDir = makeTempDir();
        const publicDir = path.join(makeTempDir(), 'site');
        const outputFile = path.join(rootDir, '.firebase-generated.json');

        writeFile(path.join(rootDir, 'firebase.json'), JSON.stringify({
            hosting: {
                public: '.',
                rewrites: [{ source: '**', destination: '/index.html' }]
            },
            firestore: {
                rules: 'firestore.rules'
            }
        }));

        const resolvedOutputFile = writeFirebaseHostingConfig(publicDir, outputFile, { rootDir });
        const config = JSON.parse(fs.readFileSync(resolvedOutputFile, 'utf8'));

        expect(config.hosting.site).toBe('game-flow-c6311');
        expect(config.hosting.public).toBe(path.resolve(publicDir));
        expect(config.hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
        expect(config.firestore.rules).toBe('firestore.rules');
    });

    it('adds immutable headers only for concrete staged app asset files', () => {
        const rootDir = makeTempDir();
        const publicDir = path.join(makeTempDir(), 'site');
        const outputFile = path.join(rootDir, '.firebase-generated.json');

        writeFile(path.join(rootDir, 'firebase.json'), JSON.stringify({
            hosting: {
                public: '.',
                headers: [
                    {
                        source: '**/*.@(js|css)',
                        headers: [{ key: 'Cache-Control', value: 'max-age=3600' }]
                    }
                ],
                rewrites: [{ source: '!/app/assets/**', destination: '/index.html' }]
            }
        }));
        writeFile(path.join(publicDir, 'app', 'assets', 'index-BUk4z7Xq.js'), 'console.log("app");');
        writeFile(path.join(publicDir, 'app', 'assets', 'style-C1ab2c3d.css'), 'body {}');

        const resolvedOutputFile = writeFirebaseHostingConfig(publicDir, outputFile, { rootDir });
        const config = JSON.parse(fs.readFileSync(resolvedOutputFile, 'utf8'));
        const immutableSources = config.hosting.headers
            .filter((rule) => rule.headers?.some((header) => header.value === 'public, max-age=31536000, immutable'))
            .map((rule) => rule.source);

        expect(immutableSources).toEqual([
            '/app/assets/index-BUk4z7Xq.js',
            '/app/assets/style-C1ab2c3d.css'
        ]);
        expect(immutableSources).not.toContain('/app/assets/**');
        expect(immutableSources).not.toContain('/app/assets/missing.js');
    });
});
