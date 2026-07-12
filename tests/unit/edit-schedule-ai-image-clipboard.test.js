// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createBulkAiImageController,
    getClipboardImageFile
} from '../../js/edit-schedule-ai-import.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class ImmediateFileReader {
    readAsDataURL(file) {
        this.result = `data:${file.type};base64,c2NoZWR1bGU=`;
        this.onload?.({ target: this });
    }
}

function createPasteEvent(items) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { items }
    });
    return event;
}

function setupController() {
    document.body.innerHTML = `
        <div id="content-bulk-ai">
            <input type="file" id="schedule-image-input" accept="image/*">
            <div id="schedule-image-preview" class="hidden">
                <img id="schedule-image-preview-img" alt="Schedule preview">
                <button type="button" id="remove-schedule-image">Remove image</button>
            </div>
            <textarea id="bulk-text-input"></textarea>
        </div>
    `;

    const controller = createBulkAiImageController({
        imageInput: document.getElementById('schedule-image-input'),
        preview: document.getElementById('schedule-image-preview'),
        previewImage: document.getElementById('schedule-image-preview-img'),
        removeButton: document.getElementById('remove-schedule-image'),
        FileReaderCtor: ImmediateFileReader
    });
    controller.bindBulkAiImageControls({
        container: document.getElementById('content-bulk-ai'),
        textInput: document.getElementById('bulk-text-input')
    });
    return controller;
}

function readEditSchedule() {
    return readFileSync(path.join(repoRoot, 'edit-schedule.html'), 'utf8');
}

function readHelperSource() {
    return readFileSync(path.join(repoRoot, 'js/edit-schedule-ai-import.js'), 'utf8');
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('edit schedule Bulk AI image clipboard support', () => {
    it('uses pasted image files for the Bulk AI image preview and process state', () => {
        const controller = setupController();
        const file = new File(['schedule image'], 'schedule.png', { type: 'image/png' });
        const event = createPasteEvent([
            { type: 'text/plain', getAsFile: () => null },
            { type: 'image/png', getAsFile: () => file }
        ]);

        document.getElementById('bulk-text-input').dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(controller.getBulkAiImageFile()).toBe(file);
        expect(document.getElementById('schedule-image-preview').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('schedule-image-preview-img').getAttribute('src')).toBe('data:image/png;base64,c2NoZWR1bGU=');
    });

    it('does not hijack plain text paste into the Bulk AI textarea', () => {
        const controller = setupController();
        const textarea = document.getElementById('bulk-text-input');
        textarea.value = 'Keep typed context';
        const event = createPasteEvent([
            { type: 'text/plain', getAsFile: () => null }
        ]);

        const dispatchResult = textarea.dispatchEvent(event);

        expect(dispatchResult).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        expect(textarea.value).toBe('Keep typed context');
        expect(controller.getBulkAiImageFile()).toBeNull();
        expect(document.getElementById('schedule-image-preview').classList.contains('hidden')).toBe(true);
    });

    it('extracts only image files from clipboard items', () => {
        const file = new File(['schedule image'], 'schedule.jpg', { type: 'image/jpeg' });
        const event = createPasteEvent([
            { type: 'text/html', getAsFile: () => new File(['html'], 'paste.html', { type: 'text/html' }) },
            { type: 'image/jpeg', getAsFile: () => file }
        ]);

        expect(getClipboardImageFile(event)).toBe(file);
    });

    it('wires edit-schedule.html to the shared paste/drop image controller', () => {
        const source = readEditSchedule();
        const helperSource = readHelperSource();

        expect(source).toContain("import { createBulkAiImageController } from './js/edit-schedule-ai-import.js?v=1';");
        expect(source).toContain('Upload, paste (Ctrl/Cmd+V), or drop a screenshot of the schedule.');
        expect(source).toContain("container: document.getElementById('content-bulk-ai')");
        expect(source).toContain("textInput: document.getElementById('bulk-text-input')");
        expect(source).toContain('bulkAiImageController.getBulkAiImageFile()');
        expect(helperSource).toContain("addEventListener('paste'");
        expect(helperSource).toContain("addEventListener('drop'");
    });
});
