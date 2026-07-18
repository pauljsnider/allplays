import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    injectPagesSecurityMeta,
    readPagesSecurityMetaPolicies,
    stagePagesBundle,
    toPagesMetaCsp,
    writeAppCheckRuntimeConfig
} from '../../scripts/stage-pages-bundle.mjs';
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

function makePagesSecurityFirebaseConfig() {
    return {
        hosting: {
            headers: [
                {
                    source: '**',
                    headers: [
                        {
                            key: 'Content-Security-Policy',
                            value: "default-src 'self'; script-src 'self'; frame-ancestors 'self'; upgrade-insecure-requests"
                        },
                        {
                            key: 'Referrer-Policy',
                            value: 'strict-origin-when-cross-origin'
                        }
                    ]
                },
                {
                    source: '/widget-scoreboard.html',
                    headers: [
                        {
                            key: 'Content-Security-Policy',
                            value: "default-src 'self'; script-src 'self' https://www.gstatic.com; frame-ancestors *; upgrade-insecure-requests"
                        }
                    ]
                }
            ]
        }
    };
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

        writeFile(path.join(rootDir, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><script src="/js/site.js"></script></head><body><h1>ALL PLAYS</h1></body></html>');
        writeFile(path.join(rootDir, 'widget-scoreboard.html'), '<!doctype html><html><head></head><body>Score</body></html>');
        writeFile(path.join(rootDir, 'css', 'site.css'), 'body {}');
        writeFile(path.join(rootDir, 'js', 'site.js'), 'export const ok = true;');
        writeFile(path.join(rootDir, 'CNAME'), 'allplays.ai');
        writeFile(path.join(rootDir, '.well-known', 'assetlinks.json'), '[]');
        writeFile(path.join(rootDir, '.well-known', 'apple-app-site-association'), '{}');
        writeFile(path.join(rootDir, 'package.json'), '{}');
        writeFile(path.join(rootDir, 'firebase.json'), JSON.stringify(makePagesSecurityFirebaseConfig()));
        writeFile(path.join(rootDir, '.firebaserc'), '{}');
        writeFile(path.join(rootDir, 'README.md'), '# private docs');
        writeFile(path.join(rootDir, 'apps', 'app', 'src', 'main.tsx'), 'source');
        writeFile(path.join(rootDir, 'apps', 'app', 'dist', 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
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
        expect(result.securityMeta.htmlFileCount).toBe(3);

        const rootHtml = fs.readFileSync(result.rootIndexPath, 'utf8');
        const appHtml = fs.readFileSync(result.appIndexPath, 'utf8');
        const widgetHtml = fs.readFileSync(path.join(destinationDir, 'widget-scoreboard.html'), 'utf8');
        for (const html of [rootHtml, appHtml, widgetHtml]) {
            expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
            expect(html.match(/name="referrer"/g)).toHaveLength(1);
            expect(html).toContain('content="strict-origin-when-cross-origin"');
            expect(html).not.toContain('frame-ancestors');
            expect(html).not.toContain("'unsafe-eval'");
        }
        expect(rootHtml).toContain(`content="${result.securityMeta.defaultCsp}"`);
        expect(appHtml).toContain(`content="${result.securityMeta.defaultCsp}"`);
        expect(widgetHtml).toContain(`content="${result.securityMeta.widgetScoreboardCsp}"`);
        expect(rootHtml.indexOf('charset="UTF-8"')).toBeLessThan(
            rootHtml.indexOf('http-equiv="Content-Security-Policy"')
        );
        expect(rootHtml.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
            rootHtml.indexOf('<script')
        );
        expect(widgetHtml).toContain('https://www.gstatic.com');
        expect(widgetHtml).not.toContain(`content="${result.securityMeta.defaultCsp}"`);

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

    it('derives Pages meta policies from Firebase Hosting without unsupported directives', () => {
        const repoRoot = path.resolve(import.meta.dirname, '../..');
        const firebaseConfig = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8')
        );
        const policies = readPagesSecurityMetaPolicies(repoRoot);
        const globalRule = firebaseConfig.hosting.headers.find((rule) => rule.source === '**');
        const widgetRule = firebaseConfig.hosting.headers.find(
            (rule) => rule.source === '/widget-scoreboard.html'
        );
        const headerValue = (rule, key) => rule.headers.find((header) => header.key === key).value;

        expect(policies.defaultCsp).toBe(
            toPagesMetaCsp(headerValue(globalRule, 'Content-Security-Policy'))
        );
        expect(policies.widgetScoreboardCsp).toBe(
            toPagesMetaCsp(headerValue(widgetRule, 'Content-Security-Policy'))
        );
        expect(policies.referrerPolicy).toBe(headerValue(globalRule, 'Referrer-Policy'));
        expect(policies.defaultCsp).not.toMatch(/frame-ancestors/i);
        expect(policies.widgetScoreboardCsp).not.toMatch(/frame-ancestors/i);
        expect(policies.defaultCsp).not.toContain("'unsafe-eval'");
        expect(policies.widgetScoreboardCsp).not.toContain("'unsafe-eval'");
    });

    it('fails closed when staged HTML cannot receive exactly one early security meta pair', () => {
        const rootDir = makeTempDir();
        const destinationDir = makeTempDir();
        writeFile(
            path.join(rootDir, 'firebase.json'),
            JSON.stringify(makePagesSecurityFirebaseConfig())
        );
        writeFile(path.join(destinationDir, 'missing-head.html'), '<main>No head</main>');

        expect(() => injectPagesSecurityMeta(destinationDir, { rootDir }))
            .toThrow(/missing a head element/);

        fs.rmSync(path.join(destinationDir, 'missing-head.html'));
        writeFile(
            path.join(destinationDir, 'duplicate.html'),
            '<html><head><meta name="referrer" content="unsafe-url"></head></html>'
        );
        expect(() => injectPagesSecurityMeta(destinationDir, { rootDir }))
            .toThrow(/already contains a referrer meta tag/);
    });

    it('rejects unsafe-eval if it drifts into the centralized Hosting policy', () => {
        expect(() => toPagesMetaCsp("default-src 'self'; script-src 'self' 'unsafe-eval'"))
            .toThrow(/must not allow unsafe-eval/);
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

    it('preserves hidden Pages files and verifies them after artifact download', () => {
        const repoRoot = path.resolve(import.meta.dirname, '../..');
        const pagesWorkflow = fs.readFileSync(
            path.join(repoRoot, '.github', 'workflows', 'app-github-pages.yml'),
            'utf8'
        );
        const intermediateUpload = pagesWorkflow.slice(
            pagesWorkflow.indexOf('- name: Upload app Pages bundle artifact'),
            pagesWorkflow.indexOf('\n  deploy:')
        );
        const deployJob = pagesWorkflow.slice(pagesWorkflow.indexOf('\n  deploy:'));
        const downloadIndex = deployJob.indexOf('- name: Download staged Pages bundle');
        const verifyIndex = deployJob.indexOf('- name: Verify staged Pages deployment artifact');
        const pagesUploadIndex = deployJob.indexOf('- name: Upload GitHub Pages artifact');

        expect(intermediateUpload).toContain('include-hidden-files: true');
        expect(deployJob).toContain('ALLPLAYS_APP_CHECK_ENFORCEMENT_READY: ${{ vars.APP_CHECK_ENFORCEMENT_READY }}');
        expect(deployJob).toContain('node scripts/verify-pages-deploy-artifact.mjs "$RUNNER_TEMP/allplays-pages"');
        expect(downloadIndex).toBeGreaterThan(-1);
        expect(verifyIndex).toBeGreaterThan(downloadIndex);
        expect(pagesUploadIndex).toBeGreaterThan(verifyIndex);
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
