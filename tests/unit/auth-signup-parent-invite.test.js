import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('auth signup parent invite failure handling', () => {
    it('fails closed by cleaning up auth user and rethrowing parent invite finalization errors', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');
        const signupSection = authSource.split('export async function signup')[1]?.split('export async function loginWithGoogle')[0];

        expect(signupSection).toBeTruthy();

        const parentInviteBranch = signupSection.match(/if \(validation\.type === 'parent_invite'\) \{([\s\S]*?)\n\s*\} else \{/);
        expect(parentInviteBranch).toBeTruthy();

        const branchBody = parentInviteBranch[1];
        expect(branchBody).toContain('await userCredential.user.delete();');
        expect(branchBody).toContain('await signOut(auth);');
        expect(branchBody).toContain('Error cleaning up failed parent invite signup');
        expect(branchBody).toMatch(/catch \(e\) \{[\s\S]*throw\s+(e|new Error\()/);
        expect(branchBody).not.toContain("Don't fail the whole signup");
    });
});
