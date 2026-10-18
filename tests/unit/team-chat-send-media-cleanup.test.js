import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team chat multi-file send cleanup', () => {
    it('rejects an 11-file batch before any legacy upload helper call while preserving the 10-file boundary', () => {
        const html = readRepoFile('team-chat.html');
        const send = html.slice(html.indexOf('async function sendMessage()'));
        const guard = 'validateChatAttachmentCount(0, imageFiles.length)';
        const rejection = "showError(error.message);\n                return;";
        const guardIndex = send.indexOf(guard);
        const rejectionIndex = send.indexOf(rejection, guardIndex);
        const firstUploadIndex = send.indexOf('await uploadChatImage(');

        expect(guardIndex).toBeGreaterThan(-1);
        expect(rejectionIndex).toBeGreaterThan(guardIndex);
        expect(rejectionIndex).toBeLessThan(firstUploadIndex);
        expect(html).toContain('validateChatAttachmentCount(0, files.length)');
        expect(html).toContain('setSelectedImage(files);');
    });

    it('imports attachment cleanup helper for failed sends', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('deleteUploadedChatAttachments');
    });

    it('uploads attachments sequentially before posting the chat message', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('for (const file of imageFiles)');
        expect(html).toContain('mediaPayloads.push(await uploadChatImage(teamId, file, { conversationId }));');
        expect(html).not.toContain('Promise.all(imageFiles.map((file) => uploadChatImage(teamId, file)))');
    });

    it('cleans up already-uploaded attachments when send fails', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('if (mediaPayloads.length > 0)');
        expect(html).toContain('await deleteUploadedChatAttachments(mediaPayloads);');
        expect(html).toContain('Failed to clean up uploaded chat attachments:');
    });

    it('shows the actionable upload failure instead of hiding it behind a generic send error', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain("showError(error?.message || 'Failed to send message. Please try again.');");
    });
});
