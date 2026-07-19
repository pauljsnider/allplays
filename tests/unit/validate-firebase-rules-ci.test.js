import { describe, expect, it } from 'vitest';
import {
    assertPreviewDeploySkipHandling,
    extractMatchBlock,
    validateFirebaseDeployWorkloadIdentity,
    validatePreviewDeployCommand,
    validateProductionDeployCommand,
    validateFirebaseRulesCi
} from '../../scripts/validate-firebase-rules-ci.mjs';

describe('validate Firebase rules CI helpers', () => {
    it('accepts the deployed RSVP note get/list privacy contract', () => {
        expect(() => validateFirebaseRulesCi()).not.toThrow();
    });

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
        run: node "$firebase_cli" hosting:channel:deploy "$CURRENT_CHANNEL" --project game-flow-c6311 --config "$firebase_config"
        preview_deploy_hit_auth_domain_sync_error() { return 1; }
        echo "refusing to report a partially functional preview"
`;

        expect(() => validatePreviewDeployCommand(validPreviewDeployStep)).not.toThrow();

        expect(() => validatePreviewDeployCommand(`
      - name: Deploy preview channel
        run: node "$firebase_cli" hosting:channel:deploy "$CURRENT_CHANNEL" --site allplays-preview --project game-flow-c6311 --config "$firebase_config"
`)).toThrow('Preview deploy must not pass --site');

        expect(() => validatePreviewDeployCommand(
            validPreviewDeployStep.replace('$firebase_config"', '$firebase_config" --no-authorized-domains')
        ))
            .toThrow('Preview deploy must preserve Firebase Auth authorized-domain synchronization');

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
          STORAGE_RULES_CHANGED: \${{ needs.prepare-deploy.outputs.storage_changed }}
        run: |
          node "$firebase_cli" deploy --only storage --project game-flow-c6311 --config "$firebase_config" --non-interactive
          sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' "$storage_log" > "$storage_plain_log"
          if [[ "$STORAGE_RULES_CHANGED" != "true" ]]; then exit 0; fi
          exit "$storage_status"
            transient_pattern='HTTP Error:[[:space:]]*409,[[:space:]]*Requested entity already exists'
            node "$firebase_cli" deploy --only "$deploy_targets" --project game-flow-c6311 --config "$firebase_config" --non-interactive
          env:
            FIRESTORE_CONFIG_CHANGED: \${{ needs.prepare-deploy.outputs.firestore_changed }}
          if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"
          else
            retry_firebase_deploy "hosting,functions" "application"
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
            'HTTP Error:[[:space:]]*409,[[:space:]]*Requested entity already exists',
            '(^|[^[:alnum:]])409([^[:alnum:]]|$)'
        ))).toThrow('Production Firestore release-race retry');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"`,
            `retry_firebase_deploy "hosting,functions" "application"
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"`
        ))).toThrow('Production Firestore deploy must run first when its configuration changed');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `else
            retry_firebase_deploy "hosting,functions" "application"`,
            `else
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"
            retry_firebase_deploy "hosting,functions" "application"`
        ))).toThrow('Production must not redeploy unchanged Firestore configuration');
    });

    it('requires pinned keyless Google authentication for Firebase deployers', () => {
        const validWorkflow = `
    jobs:
      prepare:
        permissions:
          contents: read
        steps:
          - name: Install isolated CLI
            run: npm install --ignore-scripts firebase-tools@15.24.0
      deploy:
        permissions:
          contents: read
          id-token: write
        steps:
          - name: Download trusted handoff
            uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
          - name: Authenticate to Google Cloud through exact-workflow OIDC
            uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3
            with:
              workload_identity_provider: \${{ vars.FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER }}
              service_account: \${{ vars.FIREBASE_DEPLOY_SERVICE_ACCOUNT }}
              project_id: game-flow-c6311
              create_credentials_file: true
              cleanup_credentials: true
          - name: Deploy Firebase
            timeout-minutes: 4
            run: node "$firebase_cli" deploy --only hosting --project game-flow-c6311
        `;

        expect(() => validateFirebaseDeployWorkloadIdentity(validWorkflow, 'Test deploy')).not.toThrow();
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace('id-token: write', 'id-token: none'),
            'Test deploy'
        )).toThrow('Test deploy OIDC token permission');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace('google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093', 'google-github-actions/auth@v3'),
            'Test deploy'
        )).toThrow('Test deploy pinned Google authentication action');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace('workload_identity_provider:', 'provider:'),
            'Test deploy'
        )).toThrow('Test deploy workload identity provider variable is missing or changed');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'create_credentials_file: true',
                'create_credentials_file: true\n              credentials_json: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311 }}'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              GOOGLE_APPLICATION_CREDENTIALS : \${{ secrets.RENAMED_KEY }}\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                'export GOOGLE_"APPLICATION"_CREDENTIALS=/tmp/key.json\n              node "$firebase_cli" deploy --only hosting'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                "export GOO'GLE'_''APPLICATION'_CREDENTIALS=/tmp/key.json\n              node \"$firebase_cli\" deploy --only hosting"
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace('credentials_file: true', 'credentials_file: true\n              credentials_json : \${{ secrets.RENAMED_KEY }}'),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                'gcloud auth activate-service-account --key-file /tmp/key.json\n              node "$firebase_cli" deploy --only hosting'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                'node "$firebase_cli" deploy --token "$DEPLOY_TOKEN" --only hosting'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              RENAMED_AUTH: \${{ secrets.FIREBASE_RELEASE_TOKEN }}\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: /tmp/renamed.json\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              FIREBASE_DEPLOY_TOKEN: renamed-token\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                'export FIREBASE_TOKEN="$DEPLOY_AUTH"\n              node "$firebase_cli" deploy --only hosting'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              RENAMED_AUTH: \${{ secrets.RENAMED }}\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              DEPLOY_AUTH: \${{ secrets["RENAMED"] }}\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy',
                'env:\n              FIREBASE_RELEASE_TOKEN: renamed-token\n            run: node "$firebase_cli" deploy'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'node "$firebase_cli" deploy --only hosting',
                'export FIREBASE_"TOKEN"="$DEPLOY_AUTH"\n              node "$firebase_cli" deploy --only hosting'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy --only hosting --project game-flow-c6311',
                'run: |\n              export FIREBASE_\\\n              TOKEN="$DEPLOY_AUTH"\n              node "$firebase_cli" deploy --only hosting --project game-flow-c6311'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                'run: node "$firebase_cli" deploy --only hosting --project game-flow-c6311',
                'run: |\n              node "$firebase_cli" deploy --\\\n              token "$DEPLOY_AUTH" --only hosting --project game-flow-c6311'
            ),
            'Test deploy'
        )).toThrow('Test deploy must not use a long-lived Google service-account key or static ADC input');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace('timeout-minutes: 4', 'timeout-minutes: 6'),
            'Test deploy'
        )).toThrow('Test deploy credentialed deploy step Deploy Firebase must have a timeout from one to 4 minutes');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                '          - name: Deploy Firebase',
                '          - name: Delay after authentication\n            run: sleep 1\n          - name: Deploy Firebase'
            ),
            'Test deploy'
        )).toThrow('Test deploy must authenticate immediately before each Firebase deploy step');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                '          - name: Download trusted handoff',
                '          - name: Install dependencies in credentialed job\n            run: npm install firebase-tools\n          - name: Download trusted handoff'
            ),
            'Test deploy'
        )).toThrow('Test deploy dependency, build, and raw-artifact preparation must run in a separate no-OIDC job');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                '          - name: Download trusted handoff',
                '          - name: Download raw artifact\n            run: gh api repos/example/repo/actions/artifacts/42/zip\n          - name: Download trusted handoff'
            ),
            'Test deploy'
        )).toThrow('Test deploy dependency, build, and raw-artifact preparation must run in a separate no-OIDC job');
        expect(() => validateFirebaseDeployWorkloadIdentity(
            validWorkflow.replace(
                '          - name: Download trusted handoff',
                '          - name: Checkout\n            uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd\n          - name: Download trusted handoff'
            ),
            'Test deploy'
        )).toThrow('Test deploy credentialed deploy job contains an unapproved action');
    });

    it('requires preview deploy release-target outage handling', () => {
        const deployPreview = `
          preview_deploy_hit_release_target_error()
          grep -Eiq "HTTP Error: 400, Can't release to .*resource doesn't exist or isn't a valid release target" "$log_file"
          preview_skip_reason="skip_preview_for_release_target"
          env:
            PREVIEW_SKIP_REASON: \${{ needs.deploy-preview.outputs.preview_skip_reason }}
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
        expect(() => assertPreviewDeploySkipHandling(deployPreview.replace('PREVIEW_SKIP_REASON: ${{ needs.deploy-preview.outputs.preview_skip_reason }}', ''))).toThrow(
            'Preview deploy skipped reason PR comment is missing'
        );
    });
});
