import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function collectVersionedSourceFiles(dir, root = dir) {
    const ignoredDirs = new Set([
        '.claude',
        '.git',
        '_temp',
        'android',
        'coverage',
        'dist',
        'docs',
        'ios',
        'node_modules',
        'spec',
        'tests'
    ]);
    const files = [];

    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const relativePath = path.slice(root.length + 1);
        const stat = statSync(path);

        if (relativePath === 'apps/app/bundle-visualizer.html') {
            continue;
        }

        if (stat.isDirectory()) {
            if (!ignoredDirs.has(entry)) {
                files.push(...collectVersionedSourceFiles(path, root));
            }
            continue;
        }

        if (/\.(html|js|mjs)$/.test(entry)) {
            files.push(relativePath);
        }
    }

    return files;
}

// Map the distinct `?v=` versions a shared module is imported at across the given
// deployed files, to the files using each version: { "129": ["login.html", ...] }.
// More than one key means consumers disagree — the real cache-busting bug.
function moduleVersionMap(moduleName, files) {
    const escaped = moduleName.replace(/[.]/g, '\\.');
    const re = new RegExp(`(?<![\\w-])${escaped}\\?v=(\\d+)\\b`, 'g');
    const byVersion = {};
    for (const relativePath of files) {
        const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
        for (const match of source.matchAll(re)) {
            (byVersion[match[1]] ||= new Set()).add(relativePath);
        }
    }
    return byVersion;
}

// The invariant these tests protect is *consistency*, not a frozen number: every
// deployed consumer of a shared module must import it at the same `?v=` version,
// so nobody loads a stale cached copy. Asserting derived agreement (rather than
// "must equal v129") keeps the guard green when a rebase carries a coordinated
// bump from master, while still failing on a genuinely stale consumer — the
// failure mode that actually ships a cache bug. Pinning exact numbers instead
// turned every concurrent version bump into a false failure on rebase.
describe('admin invite signup cache busting', () => {
    // Single-version modules: every deployed consumer must import the exact same
    // `?v=`. These are small/infrequently-bumped, so a split means a genuinely
    // stale consumer.
    it('keeps every deployed consumer of a single-version module on one agreed version', () => {
        const deployed = collectVersionedSourceFiles(process.cwd());
        const singleVersionModules = [
            'auth.js',
            'utils.js',
            'signup-flow.js',
            'admin-invite.js',
            'accept-invite-flow.js'
        ];

        const splits = {};
        for (const moduleName of singleVersionModules) {
            const byVersion = moduleVersionMap(moduleName, deployed);
            const versions = Object.keys(byVersion);
            if (versions.length > 1) {
                splits[moduleName] = Object.fromEntries(
                    versions.map((v) => [v, [...byVersion[v]].sort()])
                );
            }
        }

        expect(
            splits,
            `Single-version modules imported at multiple versions (stale consumers): ${JSON.stringify(splits, null, 2)}`
        ).toEqual({});
    });

    // db.js is imported by ~40 files and bumped often, so it rolls forward across
    // a couple of adjacent versions rather than flipping atomically. Enforce a
    // bounded window (all consumers within MAX_DB_VERSION_SPREAD of each other)
    // instead of exact agreement: a coordinated bump keeps the spread at 0, a
    // normal rollout stays within the window, and a truly stale consumer (many
    // versions behind) still fails. No frozen number, so rebases don't spiral.
    it('keeps db.js consumers within a bounded rollout window', () => {
        const MAX_DB_VERSION_SPREAD = 2;
        const deployed = collectVersionedSourceFiles(process.cwd());
        const byVersion = moduleVersionMap('db.js', deployed);
        const versions = Object.keys(byVersion).map(Number);

        expect(versions.length, 'db.js is not imported anywhere').toBeGreaterThan(0);

        const spread = Math.max(...versions) - Math.min(...versions);
        const detail = Object.fromEntries(
            Object.entries(byVersion).map(([v, files]) => [v, [...files].sort()])
        );
        expect(
            spread,
            `db.js consumers span too many versions (spread ${spread} > ${MAX_DB_VERSION_SPREAD}) — likely a stale consumer: ${JSON.stringify(detail, null, 2)}`
        ).toBeLessThanOrEqual(MAX_DB_VERSION_SPREAD);
    });

    it('wires the admin invite signup path to cache-busted modules', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');

        // Structural wiring must be present and cache-busted; the exact version is
        // covered by the consistency test above, not frozen here.
        expect(authSource).toContain("import { executeEmailPasswordSignup } from './signup-flow.js?v=");
        expect(authSource).toContain("import { redeemAdminInviteAcceptance, redeemAdminInviteAtomically } from './admin-invite.js?v=");
        expect(authSource).toContain("from './db.js?v=");
        expect(authSource).toContain("from './accept-invite-flow.js?v=");
    });

    it('wires admin invite redemption to cache-busted modules', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain(
            "import { validateAccessCode, redeemParentInvite, redeemHouseholdInvite, redeemCoParentInvite, redeemFriendInvite, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v="
        );
        expect(acceptInviteSource).toContain(
            "import { redeemAdminInviteAtomically } from './js/admin-invite.js?v="
        );
        expect(acceptInviteSource).toContain(
            "import { createInviteProcessor, getInviteDashboardUrl, isInviteAlreadyRedeemedError } from './js/accept-invite-flow.js?v="
        );
    });

    it('keeps the core auth.js consumers wired and version-aligned', () => {
        const consumers = [
            'login.html',
            'accept-invite.html',
            'edit-team.html',
            'js/admin.js',
            'js/live-game.js',
            'js/live-tracker.js',
            'js/track-basketball.js'
        ];

        const versions = new Set();
        for (const relativePath of consumers) {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            const match = source.match(/(?<![\w-])auth\.js\?v=(\d+)\b/);
            expect(match, `${relativePath} does not import a cache-busted auth.js`).not.toBeNull();
            versions.add(match[1]);
        }
        expect(
            [...versions],
            `Listed auth.js consumers disagree on version: ${[...versions]}`
        ).toHaveLength(1);

        const editTeamSource = readFileSync(resolve(process.cwd(), 'edit-team.html'), 'utf8');
        expect(editTeamSource).toContain("import { checkAuth, sendInviteEmail } from './js/auth.js?v=");
    });

    it('bumps the shared header logout import with auth.js consumers', () => {
        const utilsSource = readFileSync(resolve(process.cwd(), 'js/utils.js'), 'utf8');
        const logoutImports = [
            ...utilsSource.matchAll(/const \{ logout \} = await import\('\.\/auth\.js\?v=(\d+)'\);/g)
        ];

        expect(logoutImports).toHaveLength(1);

        // The dynamic logout import must agree with the auth.js version the rest of
        // the app imports statically — derived, not frozen.
        const deployed = collectVersionedSourceFiles(process.cwd());
        const authVersions = Object.keys(moduleVersionMap('auth.js', deployed));
        expect(authVersions).toHaveLength(1);
        expect(logoutImports[0][1]).toBe(authVersions[0]);
    });
});
