import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

describe('live game chat Firestore rules', () => {
    it('requires authenticated, attributed live chat and reaction creates', () => {
        expect(rules).toContain('function isLiveChatMessageCreate(data)');
        expect(rules).toContain('data.senderId == request.auth.uid');
        expect(rules).toContain('data.text.size() <= 2000');
        expect(rules).toContain("data.get('isAnonymous', false) == false");
        expect(rules).toContain('allow create: if isLiveChatMessageCreate(request.resource.data)');

        expect(rules).toContain('function isLiveReactionCreate(data)');
        expect(rules).toContain("data.type in ['fire', 'clap', 'wow', 'heart', 'hundred']");
        expect(rules).toContain("data.keys().hasOnly(['type', 'senderId', 'createdAt'])");
        expect(rules).toContain('allow create: if isLiveReactionCreate(request.resource.data)');
    });
});
