import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readFile(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('live game auth-required chat and reactions', () => {
    it('gates chat input and reaction bar behind signed-in viewers', () => {
        const source = readFile('js/live-game.js');

        expect(source).toContain('const canWriteToChat = state.chatEnabled && !!state.user;');
        expect(source).toContain("els.chatInput.placeholder = state.chatEnabled ? 'Sign in to join chat' : 'Chat disabled';");
        expect(source).toContain("els.chatLockedNotice.textContent = state.chatEnabled\n      ? 'Sign in to join live chat and reactions.'");
        expect(source).toContain("els.reactionsBar.classList.toggle('hidden', !canWriteToChat);");
        expect(source).toContain("if (!state.chatEnabled || !state.user) {");
        expect(source).toContain("showFloatingText(state.chatEnabled ? 'Sign in to chat' : 'Chat is disabled', 'text-sand/70 text-sm');");
    });

    it('uses the signed-in uid for reactions and ALL PLAYS bot chat writes', () => {
        const source = readFile('js/live-game.js');

        expect(source).toContain('senderId: state.user.uid');
        expect(source).toContain('senderId: state.user?.uid || null');
        expect(source).toContain('if (!state.user) return;');
    });

    it('keeps client-created ALL PLAYS bot chat writes inside the approved chat payload shape', () => {
        const source = readFile('js/live-game.js');
        const generateAiResponseStart = source.indexOf('async function generateAiResponse(question)');
        const buildAiPromptStart = source.indexOf('function buildAiPrompt(question)');
        const generateAiResponseSource = source.slice(generateAiResponseStart, buildAiPromptStart);

        expect(generateAiResponseSource).toContain("senderName: 'ALL PLAYS'");
        expect(generateAiResponseSource).toContain('senderPhotoUrl: null');
        expect(generateAiResponseSource).toContain('isAnonymous: false');
        expect(generateAiResponseSource).not.toContain('ai: true');
        expect(generateAiResponseSource).not.toContain('aiQuestion');
    });
});
