import { describe, expect, it, vi } from 'vitest';
import { buildPlayAnnouncement, cleanAnnouncementText, createPlayAnnouncer } from './liveGameAnnouncerService';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) || null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value))
  } as unknown as Storage;
}

describe('liveGameAnnouncerService', () => {
  it('sanitizes event descriptions before speaking', () => {
    expect(cleanAnnouncementText('  <b>Goal</b> &amp; assist&nbsp; ')).toBe('Goal & assist');
    expect(buildPlayAnnouncement({ period: 'Q2', description: '<span>Layup</span>' })).toBe('Q2. Layup');
  });

  it('speaks each enabled event once and persists the preference', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const storage = createStorage();
    const Utterance = vi.fn(function MockUtterance(this: SpeechSynthesisUtterance, text: string) {
      this.text = text;
    });
    const announcer = createPlayAnnouncer({
      speechSynthesis: { speak, cancel } as unknown as SpeechSynthesis,
      SpeechSynthesisUtterance: Utterance as unknown as typeof SpeechSynthesisUtterance,
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

  it('deduplicates events without ids by their play content', () => {
    const speak = vi.fn();
    const announcer = createPlayAnnouncer({
      speechSynthesis: { speak, cancel: vi.fn() } as unknown as SpeechSynthesis,
      SpeechSynthesisUtterance: function MockUtterance(this: SpeechSynthesisUtterance, text: string) { this.text = text; } as unknown as typeof SpeechSynthesisUtterance,
      storage: createStorage({ allplaysPlayAnnouncerEnabled: 'true' })
    });
    const play = { type: 'goal', period: 'P1', gameClockMs: 12_000, description: 'Goal by Smith' };

    expect(announcer.announceEvent(play)).toBe(true);
    expect(announcer.announceEvent({ ...play })).toBe(false);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('resumes speech when announcements are re-enabled after a page pause', () => {
    const speak = vi.fn();
    const announcer = createPlayAnnouncer({
      speechSynthesis: { speak, cancel: vi.fn() } as unknown as SpeechSynthesis,
      SpeechSynthesisUtterance: function MockUtterance(this: SpeechSynthesisUtterance, text: string) { this.text = text; } as unknown as typeof SpeechSynthesisUtterance,
      storage: createStorage()
    });

    announcer.setEnabled(true);
    announcer.setPaused(true);
    announcer.setEnabled(true);

    expect(announcer.isPaused()).toBe(false);
    expect(announcer.announceEvent({ id: 'event-2', description: 'Back live' })).toBe(true);
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
