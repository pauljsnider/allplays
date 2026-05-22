import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('parent invite auto-linking', () => {
    it('auto-accepts existing parent accounts when inviteParent finds a user', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const inviteIndex = source.indexOf('export async function inviteParent');
        expect(inviteIndex).toBeGreaterThanOrEqual(0);

        const inviteSource = source.slice(inviteIndex, inviteIndex + 3200);
        expect(inviteSource).toContain('existingUser = await getUserByEmail(normalizedParentEmail);');
        expect(inviteSource).toContain('autoLinked = await autoAcceptParentInviteForExistingUser');
        expect(inviteSource).toContain('console.warn(`Could not auto-link existing parent invite:');
        expect(inviteSource).toContain('autoLinked');
    });

    it('uses a callable function for cross-user auto-link writes and keeps the client fallback-safe', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const helperIndex = source.indexOf('async function autoAcceptParentInviteForExistingUser');
        expect(helperIndex).toBeGreaterThanOrEqual(0);

        const helperSource = source.slice(helperIndex, helperIndex + 900);
        expect(helperSource).toContain("httpsCallable(functions, 'autoAcceptParentInviteForExistingUser')");
        expect(helperSource).toContain('return Boolean(result?.data?.autoLinked);');
    });

    it('links the user, player parents list, and accepted invite atomically server-side', () => {
        const source = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
        const helperIndex = source.indexOf('exports.autoAcceptParentInviteForExistingUser');
        expect(helperIndex).toBeGreaterThanOrEqual(0);

        const helperSource = source.slice(helperIndex, helperIndex + 6200);
        expect(helperSource).toContain('firestore.runTransaction(async (transaction) =>');
        expect(helperSource).toContain('hasTeamAdminAccess({ team, uid: context.auth.uid, email: actorEmail })');
        expect(helperSource).toContain('parentOf: appendUniqueParentLink');
        expect(helperSource).toContain('parentTeamIds: appendUniqueValue');
        expect(helperSource).toContain('parentPlayerKeys: appendUniqueValue');
        expect(helperSource).toContain('existingParents.push');
        expect(helperSource).toContain("status: 'accepted'");
        expect(helperSource).toContain('autoAccepted: true');
        expect(helperSource).toContain('alreadyLinked');
    });

    it('shows auto-linked confirmation instead of code-first instructions in roster UI', () => {
        const source = readFileSync(resolve(process.cwd(), 'edit-roster.html'), 'utf8');
        expect(source).toContain('if (result.autoLinked)');
        expect(source).toContain('were linked to ${currentInvitePlayer.name} automatically');
        expect(source).toContain("codeSection.classList.add('hidden')");
        expect(source).toContain("from './js/db.js?v=36';");
    });
});
