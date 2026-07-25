import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('edit roster Bulk AI image clipboard support', () => {
    it('wires the roster AI text box to the shared paste and drop controller', () => {
        const source = readFileSync(path.join(repoRoot, 'edit-roster.html'), 'utf8');

        expect(source).toContain("import { createBulkAiImageController } from './js/edit-schedule-ai-import.js?v=2';");
        expect(source).toContain('Upload, paste (Ctrl/Cmd+V), or drop a screenshot/photo.');
        expect(source).toContain("container: document.getElementById('content-bulk-ai')");
        expect(source).toContain("textInput: document.getElementById('bulk-text-input')");
        expect(source).toContain('rosterAiImageController.getBulkAiImageFile()');
        expect(source).toContain('rosterAiImageController.clearBulkAiImage()');
    });
});
