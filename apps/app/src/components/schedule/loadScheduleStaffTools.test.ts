// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldAttemptLazyChunkReload } from '../../lib/lazyPage';
import { createScheduleStaffToolsLoader, type ScheduleStaffToolsModule } from './loadScheduleStaffTools';

describe('loadScheduleStaffTools', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('caches the dynamic import across repeated open requests', async () => {
    const module = { default: vi.fn() } as unknown as ScheduleStaffToolsModule;
    const importer = vi.fn(async () => module);
    const load = createScheduleStaffToolsLoader(importer);

    const firstRequest = load();
    const reopenRequest = load();

    expect(reopenRequest).toBe(firstRequest);
    await expect(firstRequest).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('stores the import promise before invoking a re-entrant importer', async () => {
    const module = { default: vi.fn() } as unknown as ScheduleStaffToolsModule;
    let nestedRequest: Promise<ScheduleStaffToolsModule> | undefined;
    let reentered = false;
    const importer = vi.fn(() => {
      if (!reentered) {
        reentered = true;
        nestedRequest = load();
      }
      return Promise.resolve(module);
    });
    const load = createScheduleStaffToolsLoader(importer);

    const firstRequest = load();

    await expect(firstRequest).resolves.toBe(module);
    expect(nestedRequest).toBe(firstRequest);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a non-chunk import failure', async () => {
    const module = { default: vi.fn() } as unknown as ScheduleStaffToolsModule;
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary import failure'))
      .mockResolvedValueOnce(module);
    const load = createScheduleStaffToolsLoader(importer);

    await expect(load()).rejects.toThrow('Temporary import failure');
    await expect(load()).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('releases the stale-chunk reload guard after a successful import', async () => {
    const chunkError = new TypeError('Failed to fetch dynamically imported module: /ScheduleStaffTools-old.js');
    window.sessionStorage.setItem('allplays:lazy-chunk-reload-attempted', '1');
    const module = { default: vi.fn() } as unknown as ScheduleStaffToolsModule;
    const load = createScheduleStaffToolsLoader(vi.fn(async () => module));

    await expect(load()).resolves.toBe(module);

    expect(shouldAttemptLazyChunkReload(chunkError)).toBe(true);
  });
});
