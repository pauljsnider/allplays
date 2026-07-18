import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../..');

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('admin status page', () => {
    it('ships the entitlement checker referenced by the admin ops workflow', () => {
        const workflowHtml = readRepoFile('workflow-admin-ops.html');
        const gitignore = readRepoFile('.gitignore');
        const statusPagePath = resolve(REPO_ROOT, 'check-admin-status.html');

        expect(workflowHtml).toContain('check-admin-status.html');
        expect(existsSync(statusPagePath)).toBe(true);
        expect(gitignore.split(/\r?\n/)).not.toContain('check-admin-status.html');
    });

    it('renders the documented admin and login status messages', () => {
        const statusPageHtml = readRepoFile('check-admin-status.html');

        expect(statusPageHtml).toContain("import { checkAuth } from './js/auth.js?v=51'");
        expect(statusPageHtml).toContain('isAdmin field is TRUE');
        expect(statusPageHtml).toContain('admin.html');
        expect(statusPageHtml).toContain('Not logged in');
        expect(statusPageHtml).toContain('workflow-admin-ops.html');
        expect(statusPageHtml).toContain('function removeLoadingMessage()');
        expect(statusPageHtml).not.toContain('previousElementSibling.remove()');
    });
});
