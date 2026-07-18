import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeConfigRelativePath = path.join('.well-known', 'allplays-runtime-config.json');

function isEnforcementReady(value) {
    return value === true
        || (typeof value === 'string' && ['true', '1'].includes(value.trim().toLowerCase()));
}

function isValidPublicSiteKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value.trim());
}

export function verifyPagesDeployArtifact(
    artifactDir,
    { enforcementReady = process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY } = {}
) {
    if (!artifactDir) {
        throw new Error('Pages deployment artifact directory is required.');
    }

    const resolvedArtifactDir = path.resolve(artifactDir);
    const noJekyllPath = path.join(resolvedArtifactDir, '.nojekyll');
    if (!fs.existsSync(noJekyllPath) || !fs.statSync(noJekyllPath).isFile()) {
        throw new Error('Pages deployment artifact is missing the required .nojekyll file.');
    }

    if (!isEnforcementReady(enforcementReady)) {
        return;
    }

    const runtimeConfigPath = path.join(resolvedArtifactDir, runtimeConfigRelativePath);
    let runtimeConfig;
    try {
        runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
    } catch {
        throw new Error(
            'Pages deployment artifact is missing a valid enforcement-ready App Check runtime config.'
        );
    }

    const appCheck = runtimeConfig?.appCheck;
    if (appCheck?.enabled !== true || !isValidPublicSiteKey(appCheck.recaptchaEnterpriseSiteKey)) {
        throw new Error(
            'Pages deployment artifact App Check runtime config is not enabled with a valid public site key.'
        );
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    verifyPagesDeployArtifact(process.argv[2]);
    console.log('Pages deployment artifact verified.');
}
