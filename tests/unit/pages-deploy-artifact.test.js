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

    it('always requires the expected public App Check key in a deploy job', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        expect(() => verifyPagesDeployArtifact(artifactDir))
            .toThrow(/requires a valid expected public App Check site key/);
    });

    it('fails closed when runtime config is missing or malformed', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        }))
            .toThrow(/missing a valid App Check runtime config/);

        writeFile(
            path.join(artifactDir, '.well-known', 'allplays-runtime-config.json'),
            '{not-json'
        );
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        }))
            .toThrow(/missing a valid App Check runtime config/);
    });

    it('requires an enabled runtime config matching the expected public site key', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        writeRuntimeConfig(artifactDir, {
            enabled: false,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        })).toThrow(/not enabled with the expected public site key/);

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'invalid key'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        })).toThrow(/not enabled with the expected public site key/);

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'different-public-site-key_456'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        })).toThrow(/not enabled with the expected public site key/);
    });

    it('rejects unpublished mobile association claims even when hidden files are preserved', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeFile(
            path.join(artifactDir, '.well-known', 'assetlinks.json'),
            '[{"target":{"sha256_cert_fingerprints":["REPLACE_WITH_RELEASE_CERT_SHA256_FINGERPRINT"]}}]'
        );

        expect(() => verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        })).toThrow(/must not publish \.well-known.assetlinks\.json until real mobile app association identifiers are configured/);
    });

    it('accepts the hidden runtime config without returning its key', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
            isTokenAutoRefreshEnabled: true
        });

        expect(verifyPagesDeployArtifact(artifactDir, {
            expectedSiteKey: 'public-enterprise-site-key_123'
        })).toBeUndefined();
    });
});
