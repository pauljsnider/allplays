import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('auth signup parent invite failure handling', () => {
    it('fails closed by rethrowing parent invite finalization errors', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');
        const signupSection = authSource.split('export async function signup')[1]?.split('export async function loginWithGoogle')[0];

        expect(signupSection).toBeTruthy();

        const parentInviteCatchBlock = signupSection.match(/if \(validation\.type === 'parent_invite'\)[\s\S]*?catch \(e\) \{([\s\S]*?)\n\s*\}/);
        expect(parentInviteCatchBlock).toBeTruthy();

        const catchBody = parentInviteCatchBlock[1];
        expect(catchBody).toMatch(/throw\s+(e|new Error\()/);
        expect(catchBody).not.toContain("Don't fail the whole signup");
    });
});
