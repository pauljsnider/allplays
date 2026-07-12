import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('parent invite auto-linking', () => {
    it('auto-accepts existing parent accounts without listing users in the browser', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const inviteIndex = source.indexOf('export async function inviteParent');
        expect(inviteIndex).toBeGreaterThanOrEqual(0);

        const inviteSource = source.slice(inviteIndex, inviteIndex + 3200);
        expect(inviteSource).not.toContain('getUserByEmail(normalizedParentEmail)');
        expect(inviteSource).toContain('const autoAcceptResult = await autoAcceptParentInviteForExistingUser(accessCodeId);');
        expect(inviteSource).toContain('console.warn(`Could not auto-link existing parent invite:');
        expect(inviteSource.indexOf('const { id: accessCodeId, code } = await createUniqueAccessCode(accessCodeData);'))
            .toBeLessThan(inviteSource.indexOf('await autoAcceptParentInviteForExistingUser(accessCodeId);'));
        expect(inviteSource).toContain('autoLinked');
    });

    it('uses a callable function for cross-user auto-link writes and keeps the client fallback-safe', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const helperIndex = source.indexOf('async function autoAcceptParentInviteForExistingUser');
        expect(helperIndex).toBeGreaterThanOrEqual(0);

        const helperSource = source.slice(helperIndex, helperIndex + 900);
        expect(helperSource).toContain("httpsCallable(functions, 'autoAcceptParentInviteForExistingUser')");
        expect(helperSource).toContain('autoLinked: data.autoLinked === true');
        expect(helperSource).toContain('existingUser: data.autoLinked === true');
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
        expect(source).toMatch(/from '\.\/js\/db\.js\?v=\d+';/);
    });

    it('sends a notification email to existing users even when auto-linked', () => {
        const source = readFileSync(resolve(process.cwd(), 'edit-roster.html'), 'utf8');
        // Find the existingUser branch in the invite handler
        const existingUserIdx = source.indexOf('if (result.existingUser)');
        expect(existingUserIdx).toBeGreaterThanOrEqual(0);
        const existingUserBlock = source.slice(existingUserIdx, existingUserIdx + 2000);
        // The custom transactional invite email must be queued inside the existingUser branch.
        expect(existingUserBlock).toContain('queueInviteEmail(result.code)');
        // Email is attempted before the autoLinked branch check
        expect(existingUserBlock.indexOf('queueInviteEmail')).toBeLessThan(existingUserBlock.indexOf('if (result.autoLinked)'));
        // Notification message reflects email sent for auto-linked case
        expect(existingUserBlock).toContain('emailSentForExisting');
        expect(existingUserBlock).toContain('A notification email was also sent to');
        // Non-auto-linked message also reflects email
        expect(existingUserBlock).toContain('An invite email was sent to');
    });
});
