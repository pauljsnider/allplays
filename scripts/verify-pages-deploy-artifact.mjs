import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoUnpublishableRootDevelopmentArtifacts } from './public-site-artifact-policy.mjs';
import { isAppCheckEnforcementReady } from './stage-pages-bundle.mjs';

const runtimeConfigRelativePath = path.join('.well-known', 'allplays-runtime-config.json');
const unpublishedMobileAssociationRelativePaths = [
    path.join('.well-known', 'apple-app-site-association'),
    path.join('.well-known', 'assetlinks.json')
];

function isValidPublicSiteKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value.trim());
}

export function verifyPagesDeployArtifact(
    artifactDir,
    {
        expectedSiteKey = process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY,
        expectedEnforcementReady = isAppCheckEnforcementReady(
            process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY
        )
    } = {}
) {
    if (!artifactDir) {
        throw new Error('Pages deployment artifact directory is required.');
    }

    const resolvedArtifactDir = path.resolve(artifactDir);
    const noJekyllPath = path.join(resolvedArtifactDir, '.nojekyll');
    if (!fs.existsSync(noJekyllPath) || !fs.statSync(noJekyllPath).isFile()) {
        throw new Error('Pages deployment artifact is missing the required .nojekyll file.');
    }
    assertNoUnpublishableRootDevelopmentArtifacts(resolvedArtifactDir, 'Pages deployment artifact');

    for (const relativePath of unpublishedMobileAssociationRelativePaths) {
        const associationPath = path.join(resolvedArtifactDir, relativePath);
        if (fs.existsSync(associationPath)) {
            throw new Error(
                `Pages deployment artifact must not publish ${relativePath} until real mobile app association identifiers are configured.`
            );
        }
    }

    const runtimeConfigPath = path.join(resolvedArtifactDir, runtimeConfigRelativePath);
    let runtimeConfig;
    try {
        runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
    } catch {
        throw new Error(
            'Pages deployment artifact is missing a valid App Check runtime config.'
        );
    }

    const appCheck = runtimeConfig?.appCheck;
    const hasSiteKey = Object.prototype.hasOwnProperty.call(
        appCheck ?? {},
        'recaptchaEnterpriseSiteKey'
    );
    const hasDebugToken = Object.prototype.hasOwnProperty.call(
        appCheck ?? {},
        'debugToken'
    );

    if (!isAppCheckEnforcementReady(expectedEnforcementReady)) {
        if (
            appCheck?.enabled !== false
            || appCheck?.isTokenAutoRefreshEnabled !== true
            || hasSiteKey
            || hasDebugToken
        ) {
            throw new Error(
                'Pages deployment artifact App Check runtime config must be paused without a site key or debug token.'
            );
        }
        return;
    }

    if (!isValidPublicSiteKey(expectedSiteKey)) {
        throw new Error(
            'Pages deployment requires a valid expected public App Check site key.'
        );
    }
    if (
        appCheck?.enabled !== true
        || appCheck?.isTokenAutoRefreshEnabled !== true
        || hasDebugToken
        || !isValidPublicSiteKey(appCheck.recaptchaEnterpriseSiteKey)
        || appCheck.recaptchaEnterpriseSiteKey.trim() !== expectedSiteKey.trim()
    ) {
        throw new Error(
            'Pages deployment artifact App Check runtime config is not enabled with the expected public site key.'
        );
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    verifyPagesDeployArtifact(process.argv[2]);
    console.log('Pages deployment artifact verified.');
}
