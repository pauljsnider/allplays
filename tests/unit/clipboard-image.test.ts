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

  it('routes schedule and roster imports through the image-aware private AI composer', () => {
    const scheduleSource = readFileSync(
      path.resolve(process.cwd(), 'apps/app/src/pages/Schedule.tsx'),
      'utf8'
    );
    const rosterSource = readFileSync(
      path.resolve(process.cwd(), 'apps/app/src/pages/team-detail/RosterTab.tsx'),
      'utf8'
    );
    const chatSource = readFileSync(
      path.resolve(process.cwd(), 'apps/app/src/pages/PrivateAiChat.tsx'),
      'utf8'
    );

    expect(scheduleSource).toContain("intent: 'schedule-import'");
    expect(scheduleSource).toContain('Manage with AI');
    expect(rosterSource).toContain("intent: 'roster-import'");
    expect(rosterSource).toContain('Start roster import');
    expect(chatSource).toContain('const pastedImages = getPastedImageFiles(event.clipboardData)');
    expect(chatSource).toContain('onAttachmentChange(pastedImages[0])');
  });
});
