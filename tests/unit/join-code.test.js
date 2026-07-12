import { describe, expect, it, vi } from 'vitest';
import {
    JOIN_CODE_CHARS,
    buildLegacyJoinUrl,
    generateJoinCode,
    isValidJoinCode,
    normalizeJoinCode,
    normalizeJoinCodeType
} from '../../js/join-code.js';

describe('shared join-code contract', () => {
    it('normalizes all supported code type aliases to one URL vocabulary', () => {
        expect(normalizeJoinCodeType('standard')).toBe('standard');
        expect(normalizeJoinCodeType('parent_invite')).toBe('parent');
        expect(normalizeJoinCodeType('admin_invite')).toBe('admin');
        expect(normalizeJoinCodeType('household_invite')).toBe('household');
        expect(normalizeJoinCodeType('coparent_invite')).toBe('coparent');
    });

    it('builds the same accept-invite entry point for every code type', () => {
        expect(buildLegacyJoinUrl(' abcd1234 ', 'standard')).toBe('accept-invite.html?code=ABCD1234&type=standard');
        expect(buildLegacyJoinUrl('abcd1234', 'parent_invite')).toBe('accept-invite.html?code=ABCD1234&type=parent');
        expect(buildLegacyJoinUrl('abcd1234', 'admin_invite')).toBe('accept-invite.html?code=ABCD1234&type=admin');
        expect(buildLegacyJoinUrl('abcd1234', 'household_invite')).toBe('accept-invite.html?code=ABCD1234&type=household');
        expect(buildLegacyJoinUrl('abcd1234', 'coparent_invite')).toBe('accept-invite.html?code=ABCD1234&type=coparent');
    });

    it('generates secure eight-character codes from the non-ambiguous alphabet', () => {
        const getRandomValues = vi.fn((values) => values.fill(0));
        const code = generateJoinCode({ getRandomValues });

        expect(code).toBe(JOIN_CODE_CHARS[0].repeat(8));
        expect(getRandomValues).toHaveBeenCalledTimes(1);
        expect(normalizeJoinCode(' abcd1234 ')).toBe('ABCD1234');
        expect(isValidJoinCode('ABCD1234')).toBe(true);
        expect(isValidJoinCode('short')).toBe(false);
    });
});
