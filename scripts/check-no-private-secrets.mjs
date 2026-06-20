import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SCAN_ROOTS = ['apps/app/src', 'js'];
const DEFAULT_IGNORED_DIRECTORIES = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'vendor'
]);
const DEFAULT_SCANNED_EXTENSIONS = new Set([
    '.cjs',
    '.css',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.mjs',
    '.ts',
    '.tsx'
]);

const SECRET_PATTERNS = [
    {
        name: 'private-key-block',
        pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/
    },
    {
        name: 'google-service-account-private-key',
        pattern: /"private_key"\s*:\s*"[^"]*-----BEGIN PRIVATE KEY-----/
    },
    {
        name: 'github-token',
        pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/
    },
    {
        name: 'slack-token',
        pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/
    },
    {
        name: 'stripe-secret-key',
        pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/
    },
    {
        name: 'openai-secret-key',
        pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b|\bsk-[A-Za-z0-9]{32,}\b/
    },
    {
        name: 'google-oauth-client-secret',
        pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/
    }
];

export function scanTextForPrivateSecrets(text, filePath = '<inline>') {
    const findings = [];
    const lines = text.split(/\r?\n/);

    for (const { name, pattern } of SECRET_PATTERNS) {
        for (const match of text.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
            const line = countLinesBefore(text, match.index || 0);
            findings.push({
                filePath,
                line,
                pattern: name,
                preview: lines[line - 1]?.trim() || ''
            });
        }
    }

    return findings;
}

export async function collectScannableFiles(rootDir, options = {}) {
    const scanRoots = options.scanRoots || DEFAULT_SCAN_ROOTS;
    const ignoredDirectories = options.ignoredDirectories || DEFAULT_IGNORED_DIRECTORIES;
    const scannedExtensions = options.scannedExtensions || DEFAULT_SCANNED_EXTENSIONS;
    const files = [];

    for (const scanRoot of scanRoots) {
        const absoluteRoot = path.resolve(rootDir, scanRoot);
        await walkDirectory(absoluteRoot, {
            files,
            ignoredDirectories,
            scannedExtensions
        });
    }

    return files.sort();
}

export async function scanRepositoryForPrivateSecrets(rootDir = process.cwd(), options = {}) {
    const files = await collectScannableFiles(rootDir, options);
    const findings = [];

    for (const filePath of files) {
        const text = await readFile(filePath, 'utf8');
        findings.push(...scanTextForPrivateSecrets(text, path.relative(rootDir, filePath)));
    }

    return findings;
}

async function walkDirectory(directory, context) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') {
            return [];
        }

        throw error;
    });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!context.ignoredDirectories.has(entry.name)) {
                await walkDirectory(path.join(directory, entry.name), context);
            }
            continue;
        }

        if (entry.isFile() && context.scannedExtensions.has(path.extname(entry.name))) {
            context.files.push(path.join(directory, entry.name));
        }
    }
}

function countLinesBefore(text, index) {
    return text.slice(0, index).split(/\r?\n/).length;
}

function formatFinding(finding) {
    return `${finding.filePath}:${finding.line} matched ${finding.pattern}`;
}

async function main() {
    const findings = await scanRepositoryForPrivateSecrets(process.cwd());
    if (findings.length > 0) {
        console.error('Private secret scan failed:');
        for (const finding of findings) {
            console.error(`- ${formatFinding(finding)}`);
        }
        process.exit(1);
    }

    console.log('Private secret scan passed for apps/app/src and js.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
