import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team chat multi-file send cleanup', () => {
    it('imports attachment cleanup helper for failed sends', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('deleteUploadedChatAttachments');
    });

    it('uploads attachments sequentially before posting the chat message', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('for (const file of imageFiles)');
        expect(html).toContain('mediaPayloads.push(await uploadChatImage(teamId, file));');
        expect(html).not.toContain('Promise.all(imageFiles.map((file) => uploadChatImage(teamId, file)))');
    });

    it('cleans up already-uploaded attachments when send fails', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('if (mediaPayloads.length > 0)');
        expect(html).toContain('await deleteUploadedChatAttachments(mediaPayloads);');
        expect(html).toContain('Failed to clean up uploaded chat attachments:');
    });
});
