import { describe, expect, it } from 'vitest';
import {
    assertPreviewDeploySkipHandling,
    extractMatchBlock,
    validatePreviewDeployCommand,
    validateProductionDeployCommand
} from '../../scripts/validate-firebase-rules-ci.mjs';

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

    it('guards Firebase preview deploy command compatibility with the pinned Firebase CLI', () => {
        const validPreviewDeployStep = `
      - name: Deploy preview channel
        run: ./node_modules/.bin/firebase hosting:channel:deploy "$CURRENT_CHANNEL" --project game-flow-c6311 --config "$FIREBASE_PREVIEW_CONFIG"
`;

        expect(() => validatePreviewDeployCommand(validPreviewDeployStep)).not.toThrow();

        expect(() => validatePreviewDeployCommand(`
      - name: Deploy preview channel
        run: ./node_modules/.bin/firebase hosting:channel:deploy "$CURRENT_CHANNEL" --site allplays-preview --project game-flow-c6311 --config "$FIREBASE_PREVIEW_CONFIG"
`)).toThrow('Preview deploy must not pass --site');

        expect(() => validatePreviewDeployCommand(`
      - name: Deploy preview channel
        run: firebase hosting:channel:deploy "$CURRENT_CHANNEL" --project game-flow-c6311 --config "$FIREBASE_PREVIEW_CONFIG"
`)).toThrow('Preview deploy installed Firebase CLI project/config arguments');

        expect(() => validatePreviewDeployCommand(`
      - name: Deploy preview channel
        run: npx --yes firebase-tools@15.22.1 hosting:channel:deploy "$CURRENT_CHANNEL" --project game-flow-c6311 --config "$FIREBASE_PREVIEW_CONFIG"
`)).toThrow('Preview deploy installed Firebase CLI project/config arguments');
    });

    it('keeps Storage rules deployable without blocking the normal production release', () => {
        const validDeployCommand = `
            npx firebase-tools@14.25.0 deploy --only hosting,firestore:rules,firestore:indexes,functions --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive
      - name: Deploy Firebase Storage rules when enabled
        if: vars.ENABLE_FIREBASE_STORAGE_DEPLOY == 'true'
        run: npx firebase-tools@14.25.0 deploy --only storage --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive
        `;

        expect(() => validateProductionDeployCommand(validDeployCommand)).not.toThrow();
        expect(() => validateProductionDeployCommand(validDeployCommand.replace("if: vars.ENABLE_FIREBASE_STORAGE_DEPLOY == 'true'", 'if: true'))).toThrow(
            'Optional production Storage rules deploy'
        );
    });

    it('requires preview deploy release-target outage handling', () => {
        const deployPreview = `
          preview_deploy_hit_release_target_error()
          grep -Eiq "HTTP Error: 400, Can't release to .*resource doesn't exist or isn't a valid release target" "$log_file"
          preview_skip_reason="skip_preview_for_release_target"
          env:
            PREVIEW_SKIP_REASON: \${{ steps.deploy_preview.outputs.preview_skip_reason }}
        `;

        expect(() => assertPreviewDeploySkipHandling(deployPreview)).not.toThrow();
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace('preview_deploy_hit_release_target_error()', ''))).toThrow(
            'Preview deploy release target error handling is missing'
        );
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace("HTTP Error: 400, Can't release to .*resource doesn't exist or isn't a valid release target", ''))).toThrow(
            'Preview deploy release target error classifier is missing'
        );
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace('preview_skip_reason=', ''))).toThrow(
            'Preview deploy skipped reason output is missing'
        );
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace('skip_preview_for_release_target', ''))).toThrow(
            'Preview deploy release target skip is missing'
        );
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace('PREVIEW_SKIP_REASON: ${{ steps.deploy_preview.outputs.preview_skip_reason }}', ''))).toThrow(
            'Preview deploy skipped reason PR comment is missing'
        );
    });
});
