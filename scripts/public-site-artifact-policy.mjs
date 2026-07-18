import fs from 'node:fs';
import path from 'node:path';

const unpublishedRootFiles = new Set([
    'github_run_log.txt',
    'playwright.smoke.config.js',
    'test-results.png',
    'vite.config.js',
    'vitest.config.ts'
]);
const unpublishedRootTestFile = /^test-[^/]+\.(?:html|js|ts)$/i;

export function isUnpublishableRootDevelopmentArtifact(relativePath) {
    const normalized = String(relativePath || '').split(path.sep).join('/');
    if (!normalized || normalized.includes('/')) return false;
    return unpublishedRootFiles.has(normalized) || unpublishedRootTestFile.test(normalized);
}

export function listUnpublishableRootDevelopmentArtifacts(publicDirectory) {
    if (!fs.existsSync(publicDirectory)) return [];
    return fs.readdirSync(publicDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isUnpublishableRootDevelopmentArtifact(entry.name))
        .map((entry) => entry.name)
        .sort();
}

export function assertNoUnpublishableRootDevelopmentArtifacts(publicDirectory, label = 'Public site') {
    const violations = listUnpublishableRootDevelopmentArtifacts(publicDirectory);
    if (violations.length > 0) {
        throw new Error(`${label} must not publish development artifacts: ${violations.join(', ')}`);
    }
}
