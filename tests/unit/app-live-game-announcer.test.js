// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPlayAnnouncement,
    cleanAnnouncementText,
    createPlayAnnouncer,
    getAnnouncementEventKey
} from '../../apps/app/src/lib/liveGameAnnouncer.ts';

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key) => values.get(key) || null),
        setItem: vi.fn((key, value) => values.set(key, value))
    };
}

describe('React app live game announcer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sanitizes play text and builds concise announcements', () => {
        expect(cleanAnnouncementText('  <b>Goal</b> &amp; assist&nbsp; ')).toBe('Goal & assist');
        expect(buildPlayAnnouncement({ period: 'Q2', clock: '4:32', text: '<span>Layup</span>' })).toBe('Q2. 4:32. Layup');
    });

    it('speaks new enabled plays once and persists the preference', () => {
        const speak = vi.fn();
        const cancel = vi.fn();
        const storage = createStorage();
        const Utterance = vi.fn(function MockUtterance(text) {
            this.text = text;
        });
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel },
            SpeechSynthesisUtterance: Utterance,
            storage
        });

        expect(announcer.announceEvent({ id: 'play-1', period: 'Q1', clock: '8:12', text: 'Tip-off won' })).toBe(false);
        expect(announcer.setEnabled(true)).toBe(true);
        expect(storage.setItem).toHaveBeenLastCalledWith('allplaysPlayAnnouncerEnabled', 'true');

        expect(announcer.announceEvent({ id: 'play-1', period: 'Q1', clock: '8:12', text: 'Tip-off won' })).toBe(true);
        expect(announcer.announceEvent({ id: 'play-1', period: 'Q1', clock: '8:12', text: 'Tip-off won' })).toBe(false);
        expect(speak).toHaveBeenCalledTimes(1);
        expect(Utterance.mock.instances[0].text).toBe('Q1. 8:12. Tip-off won');

        announcer.setEnabled(false);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenLastCalledWith('allplaysPlayAnnouncerEnabled', 'false');
    });

    it('deduplicates fallback keys built from play content and retries after speech failures', () => {
        const speak = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('speech unavailable');
            })
            .mockImplementation(() => {});
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel: vi.fn() },
            SpeechSynthesisUtterance: function MockUtterance(text) { this.text = text; },
            storage: createStorage({ allplaysPlayAnnouncerEnabled: 'true' })
        });
        const play = { period: 'Q3', clock: '1:02', text: 'Smith scores inside' };

        expect(getAnnouncementEventKey(play)).toBe('Q3|1:02|Smith scores inside');
        expect(announcer.announceEvent(play)).toBe(false);
        expect(announcer.announceEvent(play)).toBe(true);
        expect(announcer.announceEvent({ ...play })).toBe(false);
        expect(speak).toHaveBeenCalledTimes(2);
    });
});
