import { describe, expect, it, vi } from 'vitest';
import {
    buildPlayAnnouncement,
    cleanAnnouncementText,
    createPlayAnnouncer
} from '../../js/live-game-announcer.js';

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key) => values.get(key) || null),
        setItem: vi.fn((key, value) => values.set(key, value))
    };
}

describe('live game play announcer', () => {
    it('sanitizes event descriptions before speaking', () => {
        expect(cleanAnnouncementText('  <b>Goal</b> &amp; assist&nbsp; ')).toBe('Goal & assist');
        expect(buildPlayAnnouncement({ period: 'Q2', description: '<span>Layup</span>' })).toBe('Q2. Layup');
    });

    it('speaks each enabled event once and persists the preference', () => {
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

        expect(announcer.announceEvent({ id: 'event-1', period: 'Q1', description: 'Tip-off' })).toBe(false);
        expect(announcer.setEnabled(true)).toBe(true);
        expect(storage.setItem).toHaveBeenLastCalledWith('allplaysPlayAnnouncerEnabled', 'true');

        expect(announcer.announceEvent({ id: 'event-1', period: 'Q1', description: 'Tip-off' })).toBe(true);
        expect(announcer.announceEvent({ id: 'event-1', period: 'Q1', description: 'Tip-off' })).toBe(false);
        expect(speak).toHaveBeenCalledTimes(1);
        expect(Utterance.mock.instances[0].text).toBe('Q1. Tip-off');

        announcer.setEnabled(false);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenLastCalledWith('allplaysPlayAnnouncerEnabled', 'false');
    });

    it('supports pause without losing duplicate-event protection', () => {
        const speak = vi.fn();
        const cancel = vi.fn();
        const storage = createStorage({ allplaysPlayAnnouncerEnabled: 'true' });
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel },
            SpeechSynthesisUtterance: function MockUtterance(text) { this.text = text; },
            storage
        });

        expect(announcer.isEnabled()).toBe(true);
        expect(announcer.setPaused(true)).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(announcer.announceEvent({ id: 'event-2', description: 'Three pointer' })).toBe(false);

        announcer.setPaused(false);
        expect(announcer.announceEvent({ id: 'event-2', description: 'Three pointer' })).toBe(true);
        expect(announcer.announceEvent({ id: 'event-2', description: 'Three pointer' })).toBe(false);
        expect(speak).toHaveBeenCalledTimes(1);
    });

    it('deduplicates events without ids by their play content', () => {
        const speak = vi.fn();
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel: vi.fn() },
            SpeechSynthesisUtterance: function MockUtterance(text) { this.text = text; },
            storage: createStorage({ allplaysPlayAnnouncerEnabled: 'true' })
        });
        const play = { type: 'goal', period: 'P1', gameClockMs: 12_000, description: 'Goal by Smith' };

        expect(announcer.announceEvent(play)).toBe(true);
        expect(announcer.announceEvent({ ...play })).toBe(false);
        expect(speak).toHaveBeenCalledTimes(1);
    });

    it('scopes duplicate protection by playback session', () => {
        const speak = vi.fn();
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel: vi.fn() },
            SpeechSynthesisUtterance: function MockUtterance(text) { this.text = text; },
            storage: createStorage({ allplaysPlayAnnouncerEnabled: 'true' })
        });
        const play = { id: 'event-3', description: 'Replayable goal' };

        expect(announcer.announceEvent(play, { playbackSessionId: 'live' })).toBe(true);
        expect(announcer.announceEvent(play, { playbackSessionId: 'live' })).toBe(false);
        expect(announcer.announceEvent(play, { playbackSessionId: 'replay' })).toBe(true);
        expect(speak).toHaveBeenCalledTimes(2);
    });

    it('does not mark an event announced when speech synthesis throws', () => {
        const speak = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('speech unavailable');
            })
            .mockImplementationOnce(() => {});
        const announcer = createPlayAnnouncer({
            speechSynthesis: { speak, cancel: vi.fn() },
            SpeechSynthesisUtterance: function MockUtterance(text) { this.text = text; },
            storage: createStorage({ allplaysPlayAnnouncerEnabled: 'true' })
        });
        const play = { id: 'event-4', description: 'Retry after failure' };

        expect(announcer.announceEvent(play)).toBe(false);
        expect(announcer.announceEvent(play)).toBe(true);
        expect(speak).toHaveBeenCalledTimes(2);
    });
});
