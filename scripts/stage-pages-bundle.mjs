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
const pagesMetaUnsupportedDirectives = new Set(['frame-ancestors']);
const widgetScoreboardRelativePath = 'widget-scoreboard.html';

function normalizePublicSiteKey(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    return /^[A-Za-z0-9_-]{10,200}$/.test(normalized) ? normalized : '';
}

function isAppCheckEnforcementReady(value) {
    return typeof value === 'string' && ['true', '1'].includes(value.trim().toLowerCase());
}

function readFirebaseHostingHeader(firebaseConfig, source, key) {
    const rules = firebaseConfig?.hosting?.headers;
    if (!Array.isArray(rules)) {
        throw new Error('firebase.json must define hosting.headers for Pages security meta staging.');
    }

    const matchingRules = rules.filter((rule) => rule?.source === source);
    if (matchingRules.length !== 1) {
        throw new Error(`Expected exactly one Firebase Hosting header rule for ${source}.`);
    }

    const matchingHeaders = matchingRules[0].headers?.filter(
        (header) => typeof header?.key === 'string' && header.key.toLowerCase() === key.toLowerCase()
    ) ?? [];
    if (matchingHeaders.length !== 1 || typeof matchingHeaders[0].value !== 'string') {
        throw new Error(`Expected exactly one ${key} Firebase Hosting header for ${source}.`);
    }

    const value = matchingHeaders[0].value.trim();
    if (!value) {
        throw new Error(`${key} Firebase Hosting header for ${source} cannot be empty.`);
    }
    return value;
}

export function toPagesMetaCsp(headerPolicy) {
    if (typeof headerPolicy !== 'string' || !headerPolicy.trim()) {
        throw new Error('A non-empty Firebase Hosting CSP is required for Pages security meta staging.');
    }

    const directives = headerPolicy
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean);
    const metaDirectives = directives.filter((directive) => {
        const [name] = directive.split(/\s+/, 1);
        return !pagesMetaUnsupportedDirectives.has(name.toLowerCase());
    });
    const metaPolicy = metaDirectives.join('; ');

    if (!metaPolicy || metaPolicy.toLowerCase().includes("'unsafe-eval'")) {
        throw new Error('Pages security meta CSP must be non-empty and must not allow unsafe-eval.');
    }
    if (/(?:^|;)\s*frame-ancestors(?:\s|;|$)/i.test(metaPolicy)) {
        throw new Error('Pages security meta CSP cannot contain frame-ancestors.');
    }
    return metaPolicy;
}

export function readPagesSecurityMetaPolicies(rootDir = defaultRootDir) {
    const configPath = path.join(path.resolve(rootDir), 'firebase.json');
    let firebaseConfig;
    try {
        firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read Firebase Hosting security policy from ${configPath}: ${error.message}`);
    }

    const referrerPolicy = readFirebaseHostingHeader(firebaseConfig, '**', 'Referrer-Policy');
    if (referrerPolicy !== 'strict-origin-when-cross-origin') {
        throw new Error('Pages referrer meta must remain strict-origin-when-cross-origin.');
    }

    return {
        defaultCsp: toPagesMetaCsp(
            readFirebaseHostingHeader(firebaseConfig, '**', 'Content-Security-Policy')
        ),
        widgetScoreboardCsp: toPagesMetaCsp(
            readFirebaseHostingHeader(firebaseConfig, '/widget-scoreboard.html', 'Content-Security-Policy')
        ),
        referrerPolicy
    };
}

function escapeHtmlAttribute(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function listHtmlFiles(rootDir, currentDir = rootDir, files = []) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            listHtmlFiles(rootDir, entryPath, files);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
            files.push(entryPath);
        }
    }
    return files;
}

export function injectPagesSecurityMeta(destinationDir, { rootDir = defaultRootDir } = {}) {
    const resolvedDestination = path.resolve(destinationDir);
    const policies = readPagesSecurityMetaPolicies(rootDir);
    const htmlFiles = listHtmlFiles(resolvedDestination);
    if (htmlFiles.length === 0) {
        throw new Error('No staged HTML files were found for Pages security meta injection.');
    }

    for (const htmlPath of htmlFiles) {
        const relativePath = toRelativePath(resolvedDestination, htmlPath);
        const csp = relativePath === widgetScoreboardRelativePath
            ? policies.widgetScoreboardCsp
            : policies.defaultCsp;
        const html = fs.readFileSync(htmlPath, 'utf8');

        if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy\b/i.test(html)) {
            throw new Error(`Staged HTML already contains a CSP meta tag: ${relativePath}`);
        }
        if (/<meta\b[^>]*name\s*=\s*["']?referrer\b/i.test(html)) {
            throw new Error(`Staged HTML already contains a referrer meta tag: ${relativePath}`);
        }

        const headMatch = /<head\b[^>]*>/i.exec(html);
        if (!headMatch) {
            throw new Error(`Staged HTML is missing a head element: ${relativePath}`);
        }

        const securityMeta = [
            `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`,
            `<meta name="referrer" content="${escapeHtmlAttribute(policies.referrerPolicy)}">`
        ].join('\n    ');
        const afterHead = headMatch.index + headMatch[0].length;
        const headCloseIndex = html.search(/<\/head\s*>/i);
        if (headCloseIndex < afterHead) {
            throw new Error(`Staged HTML is missing a closing head element: ${relativePath}`);
        }

        const headContent = html.slice(afterHead, headCloseIndex);
        const charsetMatches = [...headContent.matchAll(
            /<meta\b[^>]*charset\s*=\s*["']?[^\s"'/>]+["']?[^>]*>/gi
        )];
        if (charsetMatches.length > 1) {
            throw new Error(`Staged HTML contains multiple charset meta tags: ${relativePath}`);
        }

        let htmlWithoutCharset = html;
        let charsetMeta = '';
        if (charsetMatches.length === 1) {
            const charsetMatch = charsetMatches[0];
            const charsetStart = afterHead + charsetMatch.index;
            const charsetEnd = charsetStart + charsetMatch[0].length;
            charsetMeta = `${charsetMatch[0]}\n    `;
            htmlWithoutCharset = `${html.slice(0, charsetStart)}${html.slice(charsetEnd)}`;
        }

        const securedHtml = `${htmlWithoutCharset.slice(0, afterHead)}\n    ${charsetMeta}${securityMeta}${htmlWithoutCharset.slice(afterHead)}`;
        fs.writeFileSync(htmlPath, securedHtml);
    }

    return {
        htmlFileCount: htmlFiles.length,
        ...policies
    };
}

export function writeAppCheckRuntimeConfig(destinationDir, siteKey, { requireValidSiteKey = false } = {}) {
    const normalizedSiteKey = normalizePublicSiteKey(siteKey);
    if (!normalizedSiteKey) {
        if (requireValidSiteKey) {
            throw new Error(
                'App Check enforcement-ready staging requires a valid ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY.'
            );
        }
        return null;
    }

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
        process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY,
        {
            requireValidSiteKey: isAppCheckEnforcementReady(
                process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY
            )
        }
    );
    const securityMeta = injectPagesSecurityMeta(resolvedDestination, { rootDir: resolvedRoot });

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
        appCheckRuntimeConfigPath,
        securityMeta
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const destinationDir = process.argv[2];
    const result = stagePagesBundle(destinationDir);
    console.log(`Staged legacy site root plus React app at /app/: ${result.destinationDir}`);
}
