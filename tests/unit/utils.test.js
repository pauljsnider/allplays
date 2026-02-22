import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getUrlParams,
  setUrlParams,
  escapeHtml,
  formatDate,
  formatShortDate,
  formatTime,
  extractOpponent,
  isPracticeEvent,
  shareOrCopy
} from '../../js/utils.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function mockWindowLocation({ search = '', hash = '' } = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { location: { search, hash } }
  });
}

function mockNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value
  });
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    delete globalThis.window;
  }

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
});

describe('utils helpers', () => {
  it('getUrlParams merges query and hash params with hash precedence', () => {
    mockWindowLocation({
      search: '?teamId=team-1&mode=game',
      hash: '#mode=practice&gameId=game-9'
    });

    expect(getUrlParams()).toEqual({
      teamId: 'team-1',
      mode: 'practice',
      gameId: 'game-9'
    });
  });

  it('setUrlParams writes encoded params to location hash', () => {
    mockWindowLocation();
    setUrlParams({ teamId: 'team 1', gameId: 'game-9' });
    expect(globalThis.window.location.hash).toBe('teamId=team+1&gameId=game-9');
  });

  it('escapeHtml returns empty string for nullish values', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapeHtml escapes HTML special characters', () => {
    expect(escapeHtml(`<div class="x">'&</div>`)).toBe('&lt;div class=&quot;x&quot;&gt;&#039;&amp;&lt;/div&gt;');
  });

  it('formatDate uses toDate timestamp shape', () => {
    const dateLike = {
      toLocaleDateString: vi.fn(() => '2/22/2026')
    };

    expect(formatDate({ toDate: () => dateLike })).toBe('2/22/2026');
    expect(dateLike.toLocaleDateString).toHaveBeenCalledTimes(1);
  });

  it('formatShortDate applies short date options', () => {
    const dateLike = {
      toLocaleDateString: vi.fn(() => 'Sun, Feb 22')
    };

    expect(formatShortDate({ toDate: () => dateLike })).toBe('Sun, Feb 22');
    expect(dateLike.toLocaleDateString).toHaveBeenCalledWith([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  });

  it('formatTime applies hour and minute options', () => {
    const dateLike = {
      toLocaleTimeString: vi.fn(() => '07:26 PM')
    };

    expect(formatTime({ toDate: () => dateLike })).toBe('07:26 PM');
    expect(dateLike.toLocaleTimeString).toHaveBeenCalledWith([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  it('extractOpponent handles home-away and versus naming patterns', () => {
    expect(extractOpponent('All Plays @ Rivals FC')).toBe('Rivals FC');
    expect(extractOpponent('All Plays vs All Plays U16', 'All Plays')).toBe('U16');
  });

  it('isPracticeEvent identifies practice-like summaries', () => {
    expect(isPracticeEvent('Monday Practice Session')).toBe(true);
    expect(isPracticeEvent('Skills Club Open Gym')).toBe(true);
    expect(isPracticeEvent('Championship Game')).toBe(false);
  });

  it('shareOrCopy returns shared when navigator share succeeds', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    mockNavigator({ share, clipboard: { writeText } });

    await expect(
      shareOrCopy({ title: 'Title', text: 'Body', url: 'https://allplays.test' })
    ).resolves.toEqual({ status: 'shared' });

    expect(share).toHaveBeenCalledWith({
      title: 'Title',
      text: 'Body',
      url: 'https://allplays.test'
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shareOrCopy returns aborted when user cancels share', async () => {
    const share = vi.fn().mockRejectedValue({ name: 'AbortError' });
    const writeText = vi.fn();
    mockNavigator({ share, clipboard: { writeText } });

    await expect(shareOrCopy({ text: 'Body', url: 'https://allplays.test' })).resolves.toEqual({
      status: 'aborted'
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shareOrCopy falls back to clipboard and reports write failures', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    mockNavigator({ clipboard: { writeText } });

    await expect(shareOrCopy({ text: 'Body', url: 'https://allplays.test' })).resolves.toEqual({
      status: 'copied'
    });
    expect(writeText).toHaveBeenNthCalledWith(1, 'Body\nhttps://allplays.test');

    await expect(
      shareOrCopy({ text: 'Body', url: 'https://allplays.test', clipboardText: 'custom copy' })
    ).resolves.toEqual({
      status: 'failed'
    });
    expect(writeText).toHaveBeenNthCalledWith(2, 'custom copy');
  });
});
