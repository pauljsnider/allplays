import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stagePagesBundle, writeAppCheckRuntimeConfig } from '../../scripts/stage-pages-bundle.mjs';
import { writeFirebaseHostingConfig } from '../../scripts/write-firebase-hosting-config.mjs';

const tempDirs = [];
const originalSiteKey = process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY;
const originalEnforcementReady = process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY;

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allplays-pages-bundle-'));
    tempDirs.push(dir);
    return dir;
}

function writeFile(filePath, contents = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

beforeEach(() => {
    delete process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY;
    delete process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY;
});

afterEach(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
    if (originalSiteKey === undefined) delete process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY;
    else process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY = originalSiteKey;
    if (originalEnforcementReady === undefined) delete process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY;
    else process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY = originalEnforcementReady;
});

describe('pages bundle staging', () => {
    it('keeps raw static hosting fail-open without a configured App Check key', () => {
        const repoRoot = path.resolve(import.meta.dirname, '../..');
        const runtimeConfigPath = path.join(
            repoRoot,
            '.well-known',
            'allplays-runtime-config.json'
        );
        const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));

        expect(runtimeConfig).toEqual({
            appCheck: {
                enabled: false,
                isTokenAutoRefreshEnabled: true
            }
        });
        expect(runtimeConfig.appCheck).not.toHaveProperty('recaptchaEnterpriseSiteKey');
        expect(runtimeConfig.appCheck).not.toHaveProperty('debugToken');
    });

    it('does not track generated dependency directories', () => {
        const trackedFiles = execFileSync('git', [
            'ls-files',
            '--',
            'node_modules',
            'apps/app/node_modules'
        ], {
            cwd: path.resolve(import.meta.dirname, '../..'),
            encoding: 'utf8'
        }).trim();

        expect(trackedFiles).toBe('');
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
            },
            storage: {
                rules: 'storage.rules'
            }
        }));

        const resolvedOutputFile = writeFirebaseHostingConfig(publicDir, outputFile, { rootDir });
        const config = JSON.parse(fs.readFileSync(resolvedOutputFile, 'utf8'));

        expect(config.hosting.site).toBe('game-flow-c6311');
        expect(config.hosting.public).toBe(path.resolve(publicDir));
        expect(config.hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
        expect(config.firestore.rules).toBe('firestore.rules');
        expect(config.storage.rules).toBe('storage.rules');
    });

    it('does not let the generated Hosting config ignore staged App Check config', () => {
        const rootDir = makeTempDir();
        const publicDir = path.join(makeTempDir(), 'site');
        const outputFile = path.join(rootDir, '.firebase-generated.json');

        writeFile(path.join(rootDir, 'firebase.json'), JSON.stringify({
            hosting: {
                public: '.',
                ignore: ['firebase.json', '**/.*', '**/node_modules/**']
            }
        }));
        writeFile(
            path.join(publicDir, '.well-known', 'allplays-runtime-config.json'),
            JSON.stringify({ appCheck: { enabled: true } })
        );

        const resolvedOutputFile = writeFirebaseHostingConfig(publicDir, outputFile, { rootDir });
        const config = JSON.parse(fs.readFileSync(resolvedOutputFile, 'utf8'));

        expect(config.hosting.ignore).not.toContain('**/.*');
        expect(config.hosting.ignore).toContain('firebase.json');
        expect(config.hosting.ignore).toContain('**/node_modules/**');
    });

    it('stages only a public App Check site key in well-known runtime config', () => {
        const destinationDir = makeTempDir();

        const outputPath = writeAppCheckRuntimeConfig(destinationDir, 'public-enterprise-site-key_123');
        const config = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

        expect(outputPath).toBe(path.join(destinationDir, '.well-known', 'allplays-runtime-config.json'));
        expect(config).toEqual({
            appCheck: {
                enabled: true,
                recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
                isTokenAutoRefreshEnabled: true
            }
        });
        expect(writeAppCheckRuntimeConfig(destinationDir, 'not a valid key')).toBeNull();
    });

    it('fails staging on a missing or invalid site key only after the rollout-ready gate', () => {
        const destinationDir = makeTempDir();

        expect(writeAppCheckRuntimeConfig(destinationDir, undefined)).toBeNull();
        expect(() => writeAppCheckRuntimeConfig(destinationDir, undefined, {
            requireValidSiteKey: true
        })).toThrow(/enforcement-ready staging requires a valid/);
        expect(() => writeAppCheckRuntimeConfig(destinationDir, 'not a valid key', {
            requireValidSiteKey: true
        })).toThrow(/enforcement-ready staging requires a valid/);
    });

    it('enforces the rollout-ready key gate during full bundle staging', () => {
        const rootDir = makeTempDir();
        const destinationDir = path.join(makeTempDir(), 'site');
        writeFile(path.join(rootDir, 'index.html'), '<h1>ALL PLAYS</h1>');
        writeFile(path.join(rootDir, 'apps', 'app', 'dist', 'index.html'), '<div id="root"></div>');
        process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY = 'true';

        expect(() => stagePagesBundle(destinationDir, { rootDir }))
            .toThrow(/enforcement-ready staging requires a valid/);
    });

    it('wires production, Pages, and preview staging to explicit repository variables', () => {
        const repoRoot = path.resolve(import.meta.dirname, '../..');
        const productionWorkflow = fs.readFileSync(
            path.join(repoRoot, '.github', 'workflows', 'deploy-prod.yml'),
            'utf8'
        );
        const pagesWorkflow = fs.readFileSync(
            path.join(repoRoot, '.github', 'workflows', 'app-github-pages.yml'),
            'utf8'
        );
        const previewWorkflow = fs.readFileSync(
            path.join(repoRoot, '.github', 'workflows', 'deploy-preview.yml'),
            'utf8'
        );

        for (const workflow of [productionWorkflow, pagesWorkflow, previewWorkflow]) {
            expect(workflow).toContain('ALLPLAYS_APP_CHECK_ENFORCEMENT_READY: ${{ vars.APP_CHECK_ENFORCEMENT_READY }}');
        }
        expect(productionWorkflow).toContain('vars.APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY');
        expect(pagesWorkflow).toContain('vars.APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY');
        expect(previewWorkflow).toContain('vars.APP_CHECK_PREVIEW_RECAPTCHA_ENTERPRISE_SITE_KEY');
        expect(previewWorkflow).not.toContain('APP_CHECK_PREVIEW_RECAPTCHA_ENTERPRISE_SITE_KEY ||');
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
