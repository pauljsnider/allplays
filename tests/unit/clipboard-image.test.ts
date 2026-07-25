import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  capturePastedImage,
  getClipboardImageFile
} from '../../apps/app/src/lib/clipboardImage';

describe('clipboardImage', () => {
  it('extracts the first pasted image and captures the paste', () => {
    const image = new File(['schedule'], 'schedule.png', { type: 'image/png' });
    const preventDefault = vi.fn();
    const onImage = vi.fn();

    const captured = capturePastedImage(
      {
        clipboardData: {
          items: [
            { type: 'text/plain', getAsFile: () => null },
            { type: 'image/png', getAsFile: () => image }
          ]
        },
        preventDefault
      },
      onImage
    );

    expect(captured).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onImage).toHaveBeenCalledWith(image);
  });

  it('falls back to clipboard files when items are unavailable', () => {
    const image = new File(['roster'], 'roster.webp', { type: 'image/webp' });

    expect(getClipboardImageFile({ files: [image] })).toBe(image);
  });

  it('leaves plain-text paste untouched', () => {
    const preventDefault = vi.fn();
    const onImage = vi.fn();

    const captured = capturePastedImage(
      {
        clipboardData: {
          items: [{ type: 'text/plain', getAsFile: () => null }]
        },
        preventDefault
      },
      onImage
    );

    expect(captured).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onImage).not.toHaveBeenCalled();
  });

  it('wires both app AI import text boxes to the shared paste helper', () => {
    const scheduleSource = readFileSync(
      path.resolve(process.cwd(), 'apps/app/src/components/schedule/ScheduleStaffTools.tsx'),
      'utf8'
    );
    const rosterSource = readFileSync(
      path.resolve(process.cwd(), 'apps/app/src/pages/TeamDetail.tsx'),
      'utf8'
    );

    expect(scheduleSource).toContain('onPaste={(event) => capturePastedImage(event, onImageChange)}');
    expect(scheduleSource).toContain('paste a copied schedule screenshot here to attach it');
    expect(rosterSource).toContain('onPaste={(event) => capturePastedImage(event, handleImageChange)}');
    expect(rosterSource).toContain('paste a copied roster screenshot here to attach it');
  });
});
