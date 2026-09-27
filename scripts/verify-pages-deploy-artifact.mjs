import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoUnpublishableRootDevelopmentArtifacts } from './public-site-artifact-policy.mjs';
import {
    DIAMOND_SCOREBOOK_UI_META_NAME,
    isAppCheckEnforcementReady,
    isDiamondScorebookUiRolloutEnabled,
    isMobileAssociationPublishingEnabled,
    validateMobileAssociationFiles
} from './stage-pages-bundle.mjs';

const runtimeConfigRelativePath = path.join('.well-known', 'allplays-runtime-config.json');
const diamondScorebookUiConsumerPaths = ['edit-team.html', 'edit-schedule.html'];
const mobileAssociationRelativePaths = [
    path.join('.well-known', 'apple-app-site-association'),
    path.join('.well-known', 'assetlinks.json')
];

function isValidPublicSiteKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value.trim());
}

function readMetaContent(html, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tags = [...html.matchAll(
        new RegExp(`<meta\\b(?=[^>]*\\bname\\s*=\\s*["']?${escapedName}["']?)[^>]*>`, 'gi')
    )];
    if (tags.length !== 1) return { count: tags.length, content: '' };
    const contentMatch = tags[0][0].match(
        /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    return {
        count: 1,
        content: String(contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '')
    };
}

function verifyDiamondScorebookUiMeta(artifactDir, expectedEnabled) {
    const expectedContent = expectedEnabled ? 'true' : 'false';
    for (const relativePath of diamondScorebookUiConsumerPaths) {
        let html;
        try {
            html = fs.readFileSync(path.join(artifactDir, relativePath), 'utf8');
        } catch {
            throw new Error(`Pages deployment artifact is missing ${relativePath}.`);
        }
        const meta = readMetaContent(html, DIAMOND_SCOREBOOK_UI_META_NAME);
        if (meta.count !== 1 || meta.content !== expectedContent) {
            throw new Error(
                `Pages deployment artifact ${relativePath} Diamond launch meta must appear exactly once with content="${expectedContent}".`
            );
        }
    }
}

export function verifyPagesDeployArtifact(
    artifactDir,
    {
        expectedSiteKey = process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY,
        expectedEnforcementReady = isAppCheckEnforcementReady(
            process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY
        ),
        expectedDiamondScorebookUiEnabled = isDiamondScorebookUiRolloutEnabled(
            process.env.ALLPLAYS_DIAMOND_SCOREBOOK_UI_ENABLED
        ),
        expectedMobileAssociations = isMobileAssociationPublishingEnabled(
            process.env.ALLPLAYS_PUBLISH_MOBILE_ASSOCIATIONS
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

    if (isMobileAssociationPublishingEnabled(expectedMobileAssociations)) {
        validateMobileAssociationFiles(resolvedArtifactDir);
    } else {
        for (const relativePath of mobileAssociationRelativePaths) {
            const associationPath = path.join(resolvedArtifactDir, relativePath);
            if (fs.existsSync(associationPath)) {
                throw new Error(
                    `Pages deployment artifact must not publish ${relativePath} without explicit production mobile-association opt-in.`
                );
            }
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
    const expectedDiamondEnabled = isDiamondScorebookUiRolloutEnabled(
        expectedDiamondScorebookUiEnabled
    );
    if (runtimeConfig?.diamondScorebookUiEnabled !== expectedDiamondEnabled) {
        throw new Error(
            'Pages deployment artifact Diamond scorebook UI flag does not match the exact staged rollout value.'
        );
    }
    verifyDiamondScorebookUiMeta(resolvedArtifactDir, expectedDiamondEnabled);
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
