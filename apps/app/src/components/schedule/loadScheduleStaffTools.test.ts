import { describe, expect, it, vi } from 'vitest';
import { createScheduleStaffToolsLoader, type ScheduleStaffToolsModule } from './loadScheduleStaffTools';

describe('loadScheduleStaffTools', () => {
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
});
