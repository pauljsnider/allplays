import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    escapeHtml,
    formatDate,
    formatShortDate,
    formatTime,
    shareOrCopy,
} from '../../js/utils.js';

describe('utils helper harness smoke', () => {
    let originalNavigator;

    beforeEach(() => {
        originalNavigator = globalThis.navigator;
    });

    afterEach(() => {
        if (originalNavigator === undefined) {
            delete globalThis.navigator;
        } else {
            Object.defineProperty(globalThis, 'navigator', {
                configurable: true,
                value: originalNavigator,
            });
        }
        vi.restoreAllMocks();
    });

    it('escapeHtml returns empty string for nullish input', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('escapeHtml escapes dangerous html characters', () => {
        expect(escapeHtml(`<div class="x">'&</div>`)).toBe(
            '&lt;div class=&quot;x&quot;&gt;&#039;&amp;&lt;/div&gt;',
        );
    });

    it('formatDate returns empty string for falsy timestamp', () => {
        expect(formatDate(undefined)).toBe('');
    });

    it('formatDate accepts raw timestamp values', () => {
        const now = Date.UTC(2024, 0, 15, 12, 30, 0);
        expect(formatDate(now)).toBe(new Date(now).toLocaleDateString());
    });

    it('formatDate accepts firestore-like timestamp objects', () => {
        const date = new Date(Date.UTC(2024, 1, 2, 10, 0, 0));
        expect(formatDate({ toDate: () => date })).toBe(date.toLocaleDateString());
    });

    it('formatShortDate returns empty string for missing timestamp', () => {
        expect(formatShortDate(null)).toBe('');
    });

    it('formatShortDate returns short weekday/month/day format', () => {
        const date = Date.UTC(2024, 2, 5, 8, 0, 0);
        expect(formatShortDate(date)).toBe(
            new Date(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        );
    });

    it('formatTime returns empty string for missing timestamp', () => {
        expect(formatTime(null)).toBe('');
    });

    it('formatTime returns hour/minute output', () => {
        const date = Date.UTC(2024, 3, 10, 21, 5, 0);
        expect(formatTime(date)).toBe(
            new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        );
    });

    it('shareOrCopy reports shared when navigator.share succeeds', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                share,
                clipboard: { writeText },
            },
        });

        const result = await shareOrCopy({
            title: 'AllPlays',
            text: 'Join team',
            url: 'https://example.com/join',
        });

        expect(result).toEqual({ status: 'shared' });
        expect(share).toHaveBeenCalledWith({
            title: 'AllPlays',
            text: 'Join team',
            url: 'https://example.com/join',
        });
        expect(writeText).not.toHaveBeenCalled();
    });

    it('shareOrCopy returns aborted when share is cancelled by user', async () => {
        const share = vi.fn().mockRejectedValue({ name: 'AbortError' });
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                share,
                clipboard: { writeText },
            },
        });

        const result = await shareOrCopy({
            text: 'Join team',
            url: 'https://example.com/join',
            clipboardText: 'custom-copy',
        });

        expect(result).toEqual({ status: 'aborted' });
        expect(writeText).not.toHaveBeenCalled();
    });

    it('shareOrCopy returns failed when clipboard write throws', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                clipboard: { writeText },
            },
        });

        const result = await shareOrCopy({
            text: 'Join team',
            url: 'https://example.com/join',
        });

        expect(result).toEqual({ status: 'failed' });
    });
});
