import { describe, expect, it } from 'vitest';

import { buildChatViewportSignature } from '../../apps/app/src/lib/chatLogic.ts';

describe('buildChatViewportSignature', () => {
    it('changes when the viewport height changes even if message height stays the same', () => {
        expect(buildChatViewportSignature(1000, 300, 700)).toBe('1000:300:0');
        expect(buildChatViewportSignature(1000, 240, 700)).toBe('1000:240:60');
    });

    it('changes when the reader scrolls away from the latest message without any height change', () => {
        expect(buildChatViewportSignature(1000, 300, 700)).toBe('1000:300:0');
        expect(buildChatViewportSignature(1000, 300, 640)).toBe('1000:300:60');
    });

    it('clamps the bottom offset at zero for pinned threads', () => {
        expect(buildChatViewportSignature(1000, 300, 760)).toBe('1000:300:0');
    });
});
