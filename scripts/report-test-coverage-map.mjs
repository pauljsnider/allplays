import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_MAP_PATH = 'tests/coverage/feature-coverage-map.json';

const FEATURE_PATH_KEYS = [
    'legacyPages',
    'supportPages',
    'appPages',
    'appSupportFiles',
    'unitTests',
    'integrationTests',
    'workflowTests'
];

const ACCOUNTED_HTML_KEYS = ['legacyPages', 'supportPages'];
const ACCOUNTED_APP_KEYS = ['appPages', 'appSupportFiles'];
const TEST_KEYS = ['unitTests', 'integrationTests', 'workflowTests'];

function toRepoPath(repoRoot, absolutePath) {
    return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function walkFiles(root, shouldSkipDirectory = () => false) {
    const files = [];

    function visit(directory) {
        if (!existsSync(directory)) return;
        for (const entry of readdirSync(directory)) {
            const absolutePath = path.join(directory, entry);
            const stats = statSync(absolutePath);
            if (stats.isDirectory()) {
                if (!shouldSkipDirectory(absolutePath)) {
                    visit(absolutePath);
                }
                continue;
            }
            files.push(absolutePath);
        }
    }

    visit(root);
    return files;
}

function hasPathPrefix(repoPath, prefixes) {
    return prefixes.some((prefix) => repoPath === prefix || repoPath.startsWith(`${prefix}/`));
}

function uniqueSorted(values) {
    return [...new Set(values)].sort();
}

function flattenFeatureValues(features, keys) {
    const values = [];
    for (const feature of features) {
        for (const key of keys) {
            values.push(...(feature[key] || []));
        }
    }
    return uniqueSorted(values);
}

function parseCloudFunctionExports(source) {
    return uniqueSorted([...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]));
}

export function loadCoverageMap(repoRoot = DEFAULT_REPO_ROOT, mapPath = DEFAULT_MAP_PATH) {
    const absolutePath = path.resolve(repoRoot, mapPath);
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

export function discoverRepositorySurfaces(repoRoot = DEFAULT_REPO_ROOT) {
    const ignoredDirectoryNames = [
        '.git',
        '.claude',
        'node_modules'
    ];
    const ignoredHtmlPrefixes = [
        'android',
        'apps/app/dist',
        'ios'
    ];

    const allFiles = walkFiles(repoRoot, (absolutePath) => {
        const repoPath = toRepoPath(repoRoot, absolutePath);
        const pathParts = repoPath.split('/');
        return (
            pathParts.some((part) => ignoredDirectoryNames.includes(part)) ||
            hasPathPrefix(repoPath, ignoredHtmlPrefixes)
        );
    });

    const htmlPages = allFiles
        .map((absolutePath) => toRepoPath(repoRoot, absolutePath))
        .filter((repoPath) => repoPath.endsWith('.html'))
        .sort();

    const appPageFiles = walkFiles(path.resolve(repoRoot, 'apps/app/src/pages'))
        .map((absolutePath) => toRepoPath(repoRoot, absolutePath))
        .filter((repoPath) => /\.(ts|tsx)$/.test(repoPath))
        .filter((repoPath) => !repoPath.includes('.test.'))
        .sort();

    const functionsPath = path.resolve(repoRoot, 'functions/index.js');
    const cloudFunctions = existsSync(functionsPath)
        ? parseCloudFunctionExports(readFileSync(functionsPath, 'utf8'))
        : [];

    return {
        htmlPages,
        appPageFiles,
        cloudFunctions
    };
}

function collectMissingPathReferences(repoRoot, coverageMap) {
    const missing = [];
    for (const feature of coverageMap.features || []) {
        for (const key of FEATURE_PATH_KEYS) {
            for (const repoPath of feature[key] || []) {
                if (!existsSync(path.resolve(repoRoot, repoPath))) {
                    missing.push({ feature: feature.id, key, path: repoPath });
                }
            }
        }
    }
    return missing;
}

function collectUnknownFunctionReferences(coverageMap, discoveredFunctions) {
    const exported = new Set(discoveredFunctions);
    const unknown = [];
    for (const feature of coverageMap.features || []) {
        for (const functionName of feature.cloudFunctions || []) {
            if (!exported.has(functionName)) {
                unknown.push({ feature: feature.id, functionName });
            }
        }
    }
    return unknown;
}

function collectUnmappedValues(discoveredValues, mappedValues) {
    const mapped = new Set(mappedValues);
    return discoveredValues.filter((value) => !mapped.has(value));
}

function collectDuplicateFeatureIds(features) {
    const seen = new Set();
    const duplicates = new Set();
    for (const feature of features || []) {
        if (seen.has(feature.id)) {
            duplicates.add(feature.id);
        }
        seen.add(feature.id);
    }
    return [...duplicates].sort();
}

function collectTierGaps(features) {
    const gaps = [];
    for (const feature of features || []) {
        for (const tier of feature.targetTiers || []) {
            const key = `${tier}Tests`;
            if (!Array.isArray(feature[key]) || feature[key].length === 0) {
                gaps.push({ feature: feature.id, tier });
            }
        }
    }
    return gaps;
}

function collectKnownGaps(features) {
    return (features || []).flatMap((feature) =>
        (feature.knownGaps || []).map((gap) => ({
            feature: feature.id,
            tier: gap.tier,
            description: gap.description
        }))
    );
}

export function buildCoverageReport({
    repoRoot = DEFAULT_REPO_ROOT,
    mapPath = DEFAULT_MAP_PATH
} = {}) {
    const coverageMap = loadCoverageMap(repoRoot, mapPath);
    const discovered = discoverRepositorySurfaces(repoRoot);
    const features = coverageMap.features || [];

    const mappedHtmlPages = flattenFeatureValues(features, ACCOUNTED_HTML_KEYS);
    const mappedAppFiles = flattenFeatureValues(features, ACCOUNTED_APP_KEYS);
    const mappedCloudFunctions = flattenFeatureValues(features, ['cloudFunctions']);
    const mappedTests = flattenFeatureValues(features, TEST_KEYS);

    const missingPathReferences = collectMissingPathReferences(repoRoot, coverageMap);
    const unknownFunctionReferences = collectUnknownFunctionReferences(coverageMap, discovered.cloudFunctions);
    const duplicateFeatureIds = collectDuplicateFeatureIds(features);

    return {
        mapPath,
        version: coverageMap.version,
        counts: {
            features: features.length,
            htmlPages: discovered.htmlPages.length,
            appPageFiles: discovered.appPageFiles.length,
            cloudFunctions: discovered.cloudFunctions.length,
            mappedTests: mappedTests.length
        },
        unmapped: {
            htmlPages: collectUnmappedValues(discovered.htmlPages, mappedHtmlPages),
            appPageFiles: collectUnmappedValues(discovered.appPageFiles, mappedAppFiles),
            cloudFunctions: collectUnmappedValues(discovered.cloudFunctions, mappedCloudFunctions)
        },
        invalidReferences: {
            duplicateFeatureIds,
            missingPathReferences,
            unknownFunctionReferences
        },
        tierGaps: collectTierGaps(features),
        knownGaps: collectKnownGaps(features)
    };
}

export function reportHasBlockingFailures(report) {
    return (
        report.invalidReferences.duplicateFeatureIds.length > 0 ||
        report.invalidReferences.missingPathReferences.length > 0 ||
        report.invalidReferences.unknownFunctionReferences.length > 0 ||
        report.unmapped.htmlPages.length > 0 ||
        report.unmapped.appPageFiles.length > 0 ||
        report.unmapped.cloudFunctions.length > 0
    );
}

function formatList(title, values, formatter = (value) => `  - ${value}`) {
    if (values.length === 0) return [`${title}: none`];
    return [`${title}:`, ...values.map(formatter)];
}

export function formatCoverageReport(report) {
    const lines = [
        `Coverage map: ${report.mapPath}`,
        `Features: ${report.counts.features}`,
        `HTML pages accounted: ${report.counts.htmlPages}`,
        `React page files accounted: ${report.counts.appPageFiles}`,
        `Cloud Functions accounted: ${report.counts.cloudFunctions}`,
        `Mapped test files: ${report.counts.mappedTests}`,
        ''
    ];

    lines.push(...formatList('Unmapped HTML pages', report.unmapped.htmlPages));
    lines.push(...formatList('Unmapped React page files', report.unmapped.appPageFiles));
    lines.push(...formatList('Unmapped Cloud Functions', report.unmapped.cloudFunctions));
    lines.push(...formatList(
        'Missing path references',
        report.invalidReferences.missingPathReferences,
        (item) => `  - ${item.feature}.${item.key}: ${item.path}`
    ));
    lines.push(...formatList(
        'Unknown function references',
        report.invalidReferences.unknownFunctionReferences,
        (item) => `  - ${item.feature}: ${item.functionName}`
    ));
    lines.push(...formatList('Duplicate feature ids', report.invalidReferences.duplicateFeatureIds));
    lines.push(...formatList(
        'Target tier gaps',
        report.tierGaps,
        (item) => `  - ${item.feature}: ${item.tier}`
    ));
    lines.push(...formatList(
        'Known follow-up gaps',
        report.knownGaps,
        (item) => `  - ${item.feature} [${item.tier}]: ${item.description}`
    ));

    return lines.join('\n');
}

function parseArgs(argv) {
    return {
        check: argv.includes('--check'),
        json: argv.includes('--json')
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const options = parseArgs(process.argv.slice(2));
    const report = buildCoverageReport();
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(formatCoverageReport(report));
    }

    if (options.check && reportHasBlockingFailures(report)) {
        process.exitCode = 1;
    }
}
