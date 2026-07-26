// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getPastedImageFiles } from './clipboardFiles';

describe('getPastedImageFiles', () => {
  it('returns image files from clipboard items and ignores non-images', () => {
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
    const document = new File(['text'], 'notes.txt', { type: 'text/plain' });

    const result = getPastedImageFiles({
      items: [
        { kind: 'file', type: 'text/plain', getAsFile: () => document },
        { kind: 'file', type: 'image/png', getAsFile: () => image }
      ],
      files: [document, image]
    });

    expect(result).toEqual([image]);
  });

  it('falls back to clipboard files when item metadata is unavailable', () => {
    const image = new File(['image'], 'clipboard.jpg', { type: 'image/jpeg' });

    expect(getPastedImageFiles({ files: [image] })).toEqual([image]);
    expect(getPastedImageFiles({ files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] })).toEqual([]);
  });
});
