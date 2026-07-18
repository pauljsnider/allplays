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

        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: false }))
            .toThrow(/missing the required \.nojekyll/);
    });

    it('keeps pre-enforcement rollout fail-open after hidden-file preservation is verified', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: false }))
            .not.toThrow();
    });

    it('fails closed when enforcement-ready runtime config is missing or malformed', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: true }))
            .toThrow(/missing a valid enforcement-ready App Check runtime config/);

        writeFile(
            path.join(artifactDir, '.well-known', 'allplays-runtime-config.json'),
            '{not-json'
        );
        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: 'true' }))
            .toThrow(/missing a valid enforcement-ready App Check runtime config/);
    });

    it('requires an enabled runtime config with a valid public site key', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));

        writeRuntimeConfig(artifactDir, {
            enabled: false,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: '1' }))
            .toThrow(/not enabled with a valid public site key/);

        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'invalid key'
        });
        expect(() => verifyPagesDeployArtifact(artifactDir, { enforcementReady: true }))
            .toThrow(/not enabled with a valid public site key/);
    });

    it('accepts the enforcement-ready hidden runtime config without returning its key', () => {
        const artifactDir = makeArtifact();
        writeFile(path.join(artifactDir, '.nojekyll'));
        writeRuntimeConfig(artifactDir, {
            enabled: true,
            recaptchaEnterpriseSiteKey: 'public-enterprise-site-key_123',
            isTokenAutoRefreshEnabled: true
        });

        expect(verifyPagesDeployArtifact(artifactDir, { enforcementReady: true })).toBeUndefined();
    });
});
