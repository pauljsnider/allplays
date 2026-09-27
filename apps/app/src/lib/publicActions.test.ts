import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  isPluginAvailable: vi.fn(() => false)
}));
const filesystemMocks = vi.hoisted(() => ({ writeFile: vi.fn() }));
const shareMocks = vi.hoisted(() => ({ canShare: vi.fn(), share: vi.fn() }));

vi.mock('@capacitor/core', () => ({ Capacitor: capacitorMocks }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: filesystemMocks
}));
vi.mock('@capacitor/share', () => ({ Share: shareMocks }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: vi.fn() } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));

import { exportCsvFile } from './publicActions';

describe('public CSV export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    capacitorMocks.isPluginAvailable.mockReturnValue(false);
  });

  it('downloads CSV on web with a sanitized filename', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createdLinks: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        const createdLink = originalCreateElement('a');
        createdLink.click = click;
        createdLink.remove = remove;
        createdLinks.push(createdLink);
        return createdLink;
      }
      return originalCreateElement(tagName);
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stats');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await expect(exportCsvFile('Fall 2026 / Stats', '"h"\r\n"0"\r\n')).resolves.toBe('downloaded');

    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/csv;charset=utf-8' }));
    expect(createdLinks[0]?.download).toBe('Fall-2026-Stats.csv');
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('writes and shares the exact CSV on native', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.isPluginAvailable.mockReturnValue(true);
    shareMocks.canShare.mockResolvedValue({ value: true });
    filesystemMocks.writeFile.mockResolvedValue({ uri: 'cache://stats.csv' });

    await expect(exportCsvFile('diamond.csv', '"h","h__coverage"\r\n"","not_collected"\r\n')).resolves.toBe('shared');

    expect(filesystemMocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^stats-exports\/\d+-diamond\.csv$/),
        data: '"h","h__coverage"\r\n"","not_collected"\r\n',
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true
      })
    );
    expect(shareMocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['cache://stats.csv'] }));
  });

  it('rejects empty CSV and unavailable native sharing', async () => {
    await expect(exportCsvFile('stats.csv', '   ')).rejects.toThrow(/empty/i);

    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.isPluginAvailable.mockReturnValue(true);
    shareMocks.canShare.mockResolvedValue({ value: false });
    await expect(exportCsvFile('stats.csv', '"h"\r\n')).rejects.toThrow(/not available/i);
    expect(filesystemMocks.writeFile).not.toHaveBeenCalled();
  });
});
