import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule bulk AI image paste wiring', () => {
    it('defines a shared setBulkAiImage helper that feeds the file input and preview', () => {
        const source = readEditSchedule();

        expect(source).toContain('function setBulkAiImage(file)');
        expect(source).toContain('new DataTransfer()');
        expect(source).toContain('imageInput.files = dataTransfer.files');
        expect(source).toContain("startsWith('image/')");
        expect(source).toContain('schedule-image-preview-img');
    });

    it('routes the file input change handler through setBulkAiImage', () => {
        const source = readEditSchedule();

        const changeHandler = source.match(
            /getElementById\('schedule-image-input'\)\.addEventListener\('change'[\s\S]*?\}\);/
        );
        expect(changeHandler).not.toBeNull();
        expect(changeHandler[0]).toContain('setBulkAiImage(file)');
    });

    it('wires a paste listener on the Bulk AI tab that consumes clipboard images', () => {
        const source = readEditSchedule();

        expect(source).toContain("getElementById('content-bulk-ai')");
        const pasteHandler = source.match(
            /bulkAiTabContent\.addEventListener\('paste'[\s\S]*?\n {8}\}\);/
        );
        expect(pasteHandler).not.toBeNull();
        expect(pasteHandler[0]).toContain('clipboardData');
        expect(pasteHandler[0]).toContain('getAsFile()');
        expect(pasteHandler[0]).toContain('setBulkAiImage(file)');
        // Only prevent default once an image file is actually consumed,
        // so plain text paste into the textarea keeps working.
        expect(pasteHandler[0]).toMatch(/if \(file\) \{\s*e\.preventDefault\(\);\s*setBulkAiImage\(file\);/);
    });

    it('supports dropping an image onto the Bulk AI tab', () => {
        const source = readEditSchedule();

        const dropHandler = source.match(
            /bulkAiTabContent\.addEventListener\('drop'[\s\S]*?\n {8}\}\);/
        );
        expect(dropHandler).not.toBeNull();
        expect(dropHandler[0]).toContain('dataTransfer');
        expect(dropHandler[0]).toContain('setBulkAiImage(file)');
        expect(source).toContain("bulkAiTabContent.addEventListener('dragover'");
    });

    it('mentions paste and drop in the helper copy', () => {
        const source = readEditSchedule();

        expect(source).toContain('Upload, paste (Ctrl/Cmd+V), or drop a screenshot');
    });
});
