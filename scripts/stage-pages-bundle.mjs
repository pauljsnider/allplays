import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(scriptDir, '..');

const excludedDirectories = new Set([
    '.amazonq',
    '.claude',
    '.firebase',
    '.git',
    '.github',
    '.playwright-mcp',
    '.ralph',
    '.zenflow',
    '_migration',
    '_project-docs',
    '_temp',
    'android',
    'apps',
    'docs',
    'functions',
    'ios',
    'node_modules',
    'scripts',
    'spec',
    'src',
    'test-results',
    'tests'
]);

const excludedFiles = new Set([
    'capacitor.config.json',
    'firebase.json',
    'firestore.indexes.json',
    'firestore.rules',
    'package-lock.json',
    'package.json',
    'storage.rules'
]);

const appCheckRuntimeConfigRelativePath = path.join('.well-known', 'allplays-runtime-config.json');

function normalizePublicSiteKey(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    return /^[A-Za-z0-9_-]{10,200}$/.test(normalized) ? normalized : '';
}

export function writeAppCheckRuntimeConfig(destinationDir, siteKey) {
    const normalizedSiteKey = normalizePublicSiteKey(siteKey);
    if (!normalizedSiteKey) return null;

    const outputPath = path.join(destinationDir, appCheckRuntimeConfigRelativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({
        appCheck: {
            enabled: true,
            recaptchaEnterpriseSiteKey: normalizedSiteKey,
            isTokenAutoRefreshEnabled: true
        }
    }, null, 2)}\n`);
    return outputPath;
}

function toRelativePath(rootDir, filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function shouldExclude(rootDir, sourcePath, entry) {
    const relativePath = toRelativePath(rootDir, sourcePath);
    const parts = relativePath.split('/').filter(Boolean);

    if (entry.name.startsWith('.') && parts[0] !== '.well-known') {
        return true;
    }

    if (parts.some((part) => excludedDirectories.has(part))) {
        return true;
    }

    if (entry.isFile()) {
        return excludedFiles.has(entry.name) || entry.name.endsWith('.md');
    }

    return false;
}

function copyPublicRoot(rootDir, destinationDir, currentDir = rootDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const sourcePath = path.join(currentDir, entry.name);
        if (shouldExclude(rootDir, sourcePath, entry)) {
            continue;
        }

        const relativePath = path.relative(rootDir, sourcePath);
        const destinationPath = path.join(destinationDir, relativePath);

        if (entry.isDirectory()) {
            fs.mkdirSync(destinationPath, { recursive: true });
            copyPublicRoot(rootDir, destinationDir, sourcePath);
        } else if (entry.isFile()) {
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            fs.copyFileSync(sourcePath, destinationPath);
        } else if (entry.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(sourcePath);
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            fs.symlinkSync(linkTarget, destinationPath);
        }
    }
}

export function stagePagesBundle(destinationDir, { rootDir = defaultRootDir } = {}) {
    if (!destinationDir) {
        throw new Error('Destination directory is required.');
    }

    const resolvedRoot = path.resolve(rootDir);
    const resolvedDestination = path.resolve(destinationDir);
    const appDistDir = path.join(resolvedRoot, 'apps', 'app', 'dist');
    const appDestinationDir = path.join(resolvedDestination, 'app');

    if (!fs.existsSync(appDistDir)) {
        throw new Error('Build output not found at apps/app/dist');
    }

    fs.rmSync(resolvedDestination, { recursive: true, force: true });
    fs.mkdirSync(resolvedDestination, { recursive: true });

    copyPublicRoot(resolvedRoot, resolvedDestination);

    fs.rmSync(appDestinationDir, { recursive: true, force: true });
    fs.mkdirSync(appDestinationDir, { recursive: true });
    fs.cpSync(appDistDir, appDestinationDir, { recursive: true });
    fs.writeFileSync(path.join(resolvedDestination, '.nojekyll'), '');
    const appCheckRuntimeConfigPath = writeAppCheckRuntimeConfig(
        resolvedDestination,
        process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY
    );

    const rootIndexPath = path.join(resolvedDestination, 'index.html');
    const appIndexPath = path.join(appDestinationDir, 'index.html');
    if (!fs.existsSync(rootIndexPath)) {
        throw new Error('Staged root index.html was not found.');
    }
    if (!fs.existsSync(appIndexPath)) {
        throw new Error('Staged app index.html was not found.');
    }

    return {
        destinationDir: resolvedDestination,
        rootIndexPath,
        appIndexPath,
        appCheckRuntimeConfigPath
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const destinationDir = process.argv[2];
    const result = stagePagesBundle(destinationDir);
    console.log(`Staged legacy site root plus React app at /app/: ${result.destinationDir}`);
}
