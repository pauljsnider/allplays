import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearNativeReadDedup, dedupeNativeRead } from './nativeReadDedup';

afterEach(() => clearNativeReadDedup());

describe('dedupeNativeRead', () => {
  it('collapses identical concurrent reads into one loader call', async () => {
    const loader = vi.fn(async () => 'value');
    const [a, b] = await Promise.all([
      dedupeNativeRead('teams/t1/players', loader),
      dedupeNativeRead('teams/t1/players', loader)
    ]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reuses a resolved read within the window, then refetches after it expires', async () => {
    let clock = 1_000;
    const loader = vi.fn(async () => 'value');
    const opts = { windowMs: 5_000, now: () => clock };

    await dedupeNativeRead('path', loader, opts);
    clock = 4_000; // within window
    await dedupeNativeRead('path', loader, opts);
    expect(loader).toHaveBeenCalledTimes(1);

    clock = 7_000; // past window
    await dedupeNativeRead('path', loader, opts);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keys by path so different reads are not collapsed', async () => {
    const loader = vi.fn(async (value: string) => value);
    await Promise.all([
      dedupeNativeRead('a', () => loader('a')),
      dedupeNativeRead('b', () => loader('b'))
    ]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(dedupeNativeRead('p', loader as () => Promise<string>)).rejects.toThrow('boom');
    await expect(dedupeNativeRead('p', loader as () => Promise<string>)).resolves.toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
