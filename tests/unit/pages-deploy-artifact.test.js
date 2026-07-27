import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyPagesDeployArtifact } from '../../scripts/verify-pages-deploy-artifact.mjs';

const tempDirs = [];

function makeArtifact() {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allplays-pages-deploy-'));
    tempDirs.push(artifactDir);
    return artifactDir;
}

function writeFile(filePath, contents = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

function writeRuntimeConfig(artifactDir, appCheck) {
    writeFile(
        path.join(artifactDir, '.well-known', 'allplays-runtime-config.json'),
        JSON.stringify({ appCheck })
    );
}

afterEach(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe('Pages deployment artifact verification', () => {
    it('always requires the hidden .nojekyll file', () => {
        const artifactDir = makeArtifact();

        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/missing the required \.nojekyll/);
    });

    it('requires the expected public App Check key only when rollout-ready', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeRuntimeConfig(artifactDir, {
            enabled: true,
            isTokenAutoRefreshEnabled: true
        });

        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedEnforcementReady: true
        }))
            .toThrow(/requires a valid expected public App Check site key/);
    });

    it('fails closed when runtime config is missing or malformed', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/missing a valid App Check runtime config/);

        writeFile(
            path.join(artifactDir, '.well-known', 'allplays-runtime-config.json'),
            '{not-json'
        );
        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/missing a valid App Check runtime config/);
    });

    it('requires a paused runtime config without a site key or debug token by default', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/must be paused without a site key or debug token/);

        writeRuntimeConfig(artifactDir, {
            enabled: false,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
            isTokenAutoRefreshEnabled: true
        });
        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/must be paused without a site key or debug token/);

        writeRuntimeConfig(artifactDir, {
            enabled: false,
            isTokenAutoRefreshEnabled: true,
            debugToken: 'must-not-be-published'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/must be paused without a site key or debug token/);
    });

    it('requires an enabled runtime config matching the expected public site key when rollout-ready', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'invalid key',
            isTokenAutoRefreshEnabled: true
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123',
            expectedEnforcementReady: true
        })).toThrow(/not enabled with the expected public site key/);

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
            isTokenAutoRefreshEnabled: true,
            debugToken: 'must-not-be-published'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123',
            expectedEnforcementReady: true
        })).toThrow(/not enabled with the expected public site key/);

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'different-public-site-key_456',
            isTokenAutoRefreshEnabled: true
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123',
            expectedEnforcementReady: true
        })).toThrow(/not enabled with the expected public site key/);
    });

    it('rejects unpublished mobile association claims even when hidden files are preserved', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeFile(
            path.join(artifactDir, '.well-known', 'assetlinks.json'),
            '[{"target":{"sha256_cert_fingerprints":["REPLACE_WITH_RELEASE_CERT_SHA256_FINGERPRINT"]}}]'
        );

        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/must not publish \.well-known.assetlinks\.json until real mobile app association identifiers are configured/);
    });

    it('rejects local development artifacts from a downloaded Pages bundle', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeFile(path.join(artifactDir, 'github_run_log.txt'), 'internal CI log');

        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/Pages deployment artifact must not publish development artifacts: github_run_log\.txt/);
    });

    it('accepts a paused hidden runtime config without requiring or returning a key', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeRuntimeConfig(artifactDir, {
            enabled: false,
            isTokenAutoRefreshEnabled: true
        });

        expect(verifyPagesDeployArtifact(artifactDir)).toBeUndefined();
    });

    it('accepts the expected enabled runtime config only when rollout-ready', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
            isTokenAutoRefreshEnabled: true
        });

        expect(verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123',
            expectedEnforcementReady: true
        })).toBeUndefined();
    });
});
