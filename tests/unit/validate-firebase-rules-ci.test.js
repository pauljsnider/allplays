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

    it('skips an unavailable Storage service only when rules are unchanged', () => {
        const validDeployCommand = `
      - name: Checkout
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
      permissions:
        actions: read
      - name: Detect Storage rules changes
        id: storage_rules
        run: git diff --quiet "\${{ github.event.before }}" "\${{ github.sha }}" -- storage.rules
      - name: Detect Firestore configuration changes
        id: firestore_config
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          lookup_max_attempts=3
          for ((lookup_attempt = 1; lookup_attempt <= lookup_max_attempts; lookup_attempt += 1)); do
            if last_success_sha="$(gh api --method GET "repos/\${GITHUB_REPOSITORY}/actions/workflows/deploy-prod.yml/runs" -f branch="$GITHUB_REF_NAME" -f status=success)"; then
              lookup_succeeded="true"
            fi
          done
          if [[ "$lookup_succeeded" != "true" ]]; then
            echo "The successful production deploy lookup failed; forcing Firestore-first ordering."
            echo "changed=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json
      - name: Deploy Firebase Storage rules when available
        env:
          STORAGE_RULES_CHANGED: \${{ steps.storage_rules.outputs.changed }}
        run: |
          npx firebase-tools@14.25.0 deploy --only storage --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive
          sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' "$storage_log" > "$storage_plain_log"
          if [[ "$STORAGE_RULES_CHANGED" != "true" ]]; then exit 0; fi
          exit "$storage_status"
            npx firebase-tools@14.25.0 deploy --only "$deploy_targets" --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive
          env:
            FIRESTORE_CONFIG_CHANGED: \${{ steps.firestore_config.outputs.changed }}
          if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"
          else
            retry_firebase_deploy "hosting,functions" "application"
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
          fi
        `;

        expect(() => validateProductionDeployCommand(validDeployCommand)).not.toThrow();
        expect(() => validateProductionDeployCommand(validDeployCommand.replace('[[ "$STORAGE_RULES_CHANGED" != "true" ]]', '[[ true ]]'))).toThrow(
            'Production Storage rules unchanged-only skip'
        );
        expect(() => validateProductionDeployCommand(validDeployCommand.replace("sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' \"$storage_log\" > \"$storage_plain_log\"", ''))).toThrow(
            'Production Storage rules ANSI log normalization'
        );
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json',
            'git diff --quiet "\${{ github.event.before }}" "\${{ github.sha }}" -- firestore.rules firestore.indexes.json'
        ))).toThrow('Production Firestore change detection is missing');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'if last_success_sha="$(gh api',
            'last_success_sha="$(gh api'
        ))).toThrow('Production successful deploy guarded lookup is missing');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'echo "changed=true" >> "$GITHUB_OUTPUT"',
            'echo "changed=false" >> "$GITHUB_OUTPUT"'
        ))).toThrow('Production successful deploy lookup failure must force Firestore-first ordering');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"`,
            `retry_firebase_deploy "hosting,functions" "application"
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"`
        ))).toThrow('Production Firestore deploy must run first when its configuration changed');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `else
            retry_firebase_deploy "hosting,functions" "application"
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"`,
            `else
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"`
        ))).toThrow('Production application deploy must run first when Firestore configuration is unchanged');
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
