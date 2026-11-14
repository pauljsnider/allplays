import { describe, expect, it, vi } from 'vitest';
import {
    JOIN_CODE_CHARS,
    buildLegacyJoinUrl,
    buildAppJoinUrl,
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
        expect(normalizeJoinCodeType('friend_invite')).toBe('friend');
    });

    it('builds the same accept-invite entry point for every code type', () => {
        expect(buildLegacyJoinUrl(' abcd1234 ', 'standard')).toBe('accept-invite.html?code=ABCD1234&type=standard');
        expect(buildLegacyJoinUrl('abcd1234', 'parent_invite')).toBe('accept-invite.html?code=ABCD1234&type=parent');
        expect(buildLegacyJoinUrl('abcd1234', 'admin_invite')).toBe('accept-invite.html?code=ABCD1234&type=admin');
        expect(buildLegacyJoinUrl('abcd1234', 'household_invite')).toBe('accept-invite.html?code=ABCD1234&type=household');
        expect(buildLegacyJoinUrl('abcd1234', 'coparent_invite')).toBe('accept-invite.html?code=ABCD1234&type=coparent');
        expect(buildLegacyJoinUrl('abcd1234', 'friend_invite')).toBe('accept-invite.html?code=ABCD1234&type=friend');
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


describe('shareable invitation origins', () => {
    it.each([
        'https://localhost', 'http://localhost:5174', 'https://LOCALHOST.',
        'http://127.0.0.1:8000', 'http://127.1', 'http://[::1]:8000',
        'http://192.168.1.4:5174', 'http://10.0.2.2', 'http://172.16.0.1',
        'http://0.0.0.0:5174', 'https://dev.localhost', 'http://allplays.local',
        'capacitor://localhost', 'ionic://localhost', 'file:///app/index.html'
    ])('replaces device-only origin %s with the public site', (origin) => {
        expect(buildAppJoinUrl('FRIEND12', 'friend_invite', origin)).toBe(
            'https://allplays.ai/app/#/accept-invite?code=FRIEND12&type=friend'
        );
        expect(buildLegacyJoinUrl('FRIEND12', 'friend_invite', origin)).toBe(
            'https://allplays.ai/accept-invite.html?code=FRIEND12&type=friend'
        );
    });

    it.each(['https://allplays.ai', 'https://game-flow-c6311.web.app',
        'https://game-flow-c6311--preview-abc.web.app', 'https://preview.example:8443',
        'http://preview.example:8080'])('preserves deployment origin %s', (origin) => {
        expect(buildAppJoinUrl('FRIEND12', 'friend', origin)).toBe(
            `${origin}/app/#/accept-invite?code=FRIEND12&type=friend`
        );
    });
});
