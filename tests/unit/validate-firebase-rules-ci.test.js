import { describe, expect, it } from 'vitest';
import { extractMatchBlock } from '../../scripts/validate-firebase-rules-ci.mjs';

describe('validate Firebase rules CI helpers', () => {
    it('scopes legacy game clip assertions to the flat path block', () => {
        const storageRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /game-clips/{teamId}/{gameId}/{userId}/{fileName} {
      allow get: if isSignedIn();
    }

    match /stat-sheets/{fileName} {
      allow get, create, delete: if false;
    }

    match /game-clips/{fileName} {
      allow get, create, delete: if false;
      allow list, update: if false;
    }

    match /athlete-profile-media/{userId}/{profileId}/{fileName} {
      allow get: if true;
    }
  }
}`;

        const legacyGameClipRules = extractMatchBlock(storageRules, 'match /game-clips/{fileName} {');

        expect(legacyGameClipRules).toContain('allow get, create, delete: if false;');
        expect(legacyGameClipRules).not.toContain('match /stat-sheets/{fileName}');
        expect(legacyGameClipRules).not.toContain('match /game-clips/{teamId}/{gameId}/{userId}/{fileName}');
    });
});
