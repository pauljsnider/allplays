import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FIRESTORE_RULES_DEPLOY_BUDGET_BYTES,
    assertPreviewDeploySkipHandling,
    extractMatchBlock,
    validateFirestoreRulesDeployBudget,
    validateFirestoreRulesDeployBudgets,
    validateFirebaseDeployWorkloadIdentity,
    validatePreviewDeployCommand,
    validateProductionDeployCommand,
    validateFirebaseRulesCi
} from '../../scripts/validate-firebase-rules-ci.mjs';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

describe('validate Firebase rules CI helpers', () => {
    it('keeps Firestore rules below the reliable production deploy budget', () => {
        expect(() => validateFirestoreRulesDeployBudget(
            'x'.repeat(FIRESTORE_RULES_DEPLOY_BUDGET_BYTES)
        )).not.toThrow();
        expect(() => validateFirestoreRulesDeployBudget(
            'x'.repeat(FIRESTORE_RULES_DEPLOY_BUDGET_BYTES + 1)
        )).toThrow(/avoid Firebase Rules backend failures/);
    });

    it('budgets both compact final and generated certificate compatibility rules', () => {
        const finalRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        const sizes = validateFirestoreRulesDeployBudgets(finalRules);

        expect(sizes.finalBytes).toBeLessThanOrEqual(FIRESTORE_RULES_DEPLOY_BUDGET_BYTES);
        expect(sizes.certificateCompatibilityBytes)
            .toBeLessThanOrEqual(FIRESTORE_RULES_DEPLOY_BUDGET_BYTES);
    });

    it('rejects a generated certificate compatibility artifact that exceeds the budget', () => {
        const serverOnlyDefaultsBlock = `      match /settings/{settingId} {
        allow read: if settingId == 'certificateDefaults' &&
                       isTeamOwnerOrAdmin(teamId);
        // Certificate defaults can retire legacy uploader-owned Storage paths.
        // All writes must cross the callable's trusted provenance/tombstone checks.
        allow create, update, delete: if false;
      }`;
        const compactBlockBytes = Buffer.byteLength(
            compactFirestoreRules(serverOnlyDefaultsBlock),
            'utf8'
        );
        const finalRulesAtBudget = serverOnlyDefaultsBlock +
            'x'.repeat(FIRESTORE_RULES_DEPLOY_BUDGET_BYTES - compactBlockBytes);

        expect(() => validateFirestoreRulesDeployBudgets(finalRulesAtBudget)).toThrow(
            /Compacted certificate-defaults compatibility rules.*avoid Firebase Rules backend failures/
        );
    });

    it('accepts the deployed RSVP note get/list privacy contract', () => {
        expect(() => validateFirebaseRulesCi()).not.toThrow();
    });

    it('requires chat attachment admin deletes to retain conversation access', () => {
        const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
        const chatFallbackRules = extractMatchBlock(
            storageRules,
            'match /stat-sheets/team-chat/{teamId}/{conversationId}/{userId}/{fileName} {'
        );

        expect(chatFallbackRules).toContain(`allow delete: if (isVerifiedForSensitiveWrite() &&
        isTeamOwnerOrAdmin(teamId) &&
        canAccessChatAttachment(teamId, conversationId)) ||
        canDeleteOwnChatAttachment(teamId, conversationId, userId);`);
        expect(chatFallbackRules).not.toContain(
            'isVerifiedForSensitiveWrite() && isTeamOwnerOrAdmin(teamId)) ||'
        );
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
on:
  push:
    branches:
      - master
  workflow_dispatch:

concurrency:
  group: production-deploy-\${{ github.ref }}
  cancel-in-progress: false

      - name: Checkout
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
      permissions:
        actions: read
        deployments: read
        deployments: write
      outputs:
        certificate_defaults_lockdown_needed: \${{ steps.firestore_config.outputs.certificate_defaults_lockdown_needed }}
        firestore_baseline_sha: \${{ steps.firestore_config.outputs.firestore_baseline_sha }}
        firestore_baseline_mode: \${{ steps.firestore_config.outputs.firestore_baseline_mode }}
        storage_changed: \${{ steps.firestore_config.outputs.storage_changed }}
      - name: Detect Firebase rules changes
        id: firestore_config
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          baseline_branch="$GITHUB_REF_NAME"
          if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]; then
            if [[ "$GITHUB_REF" != "refs/heads/master" ]]; then
              exit 1
            fi
            baseline_branch="master"
          fi
          lookup_max_attempts=3
          latest_prior_run_id="$latest_prior_run_id"
          run_history_lookup_succeeded="true"
          jq 'select((.id | tostring) != $current)'
          echo "The production run history lookup failed; the active Firestore release mode is unknown."
          for ((lookup_attempt = 1; lookup_attempt <= lookup_max_attempts; lookup_attempt += 1)); do
            if last_success_run_json="$(gh api --method GET "repos/\${GITHUB_REPOSITORY}/actions/workflows/deploy-prod.yml/runs" -f branch="$baseline_branch" -f status=success)"; then
              lookup_succeeded="true"
            fi
          done
          if [[ "$lookup_succeeded" != "true" ]]; then
            echo "The successful production deploy lookup failed; forcing authorization rules-first ordering."
            echo "certificate_defaults_lockdown_needed=unknown" >> "$GITHUB_OUTPUT"
            echo "firestore_baseline_sha=unknown" >> "$GITHUB_OUTPUT"
            echo "changed=true" >> "$GITHUB_OUTPUT"
            echo "storage_changed=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          component_page=1
          gh api --method GET "repos/\${GITHUB_REPOSITORY}/deployments" -f environment=production-firestore -F per_page=100 -F page="$component_page"
          deployment_page_count=100
          jq '[.[] | select(.state == "success")][0] // empty'
          if (( deployment_page_count < 100 )); then break; fi
          component_page=$((component_page + 1))
          component_marker_found="true"
          deployment_log_url="$deployment_log_url"
          echo "The latest prior production run identity is missing or did not produce the active component marker; forcing live mode classification."
          if [[ ! "$latest_prior_run_id" =~ ^[0-9]+$ ]] \
            || [[ ! "$firestore_success_run_id" =~ ^[0-9]+$ ]] \
            || [[ "$firestore_success_run_id" != "$latest_prior_run_id" ]]; then
            firestore_success_mode="ambiguous"
          fi
          echo "No valid successful production deploy baseline was found; conservatively enabling every non-Firestore migration."
          if [[ "$component_marker_found" == "true" ]]; then
            echo "firestore_baseline_sha=$firestore_success_sha" >> "$GITHUB_OUTPUT"
            echo "Preserving the durable Firestore component baseline despite unavailable successful workflow history."
          fi
          echo "The last successful production deploy commit is unavailable locally; conservatively enabling every non-Firestore migration."
          echo "The Firestore component deployment lookup failed; the active release mode is unknown."
          firestore_success_mode="unmarked"
          firestore_success_mode="ambiguous"
          echo "forcing live exact-source classification"
          if [[ "$deployment_description" == *"compatibility rules"* ]]; then firestore_success_mode="compatibility"; fi
          firestore_success_sha="$deployment_sha"
          git show "\${firestore_success_sha}:firestore.rules" | grep -Fq 'allow create, update, delete: if false;'
          echo "certificate_defaults_lockdown_needed=false" >> "$GITHUB_OUTPUT"
          if [[ "$component_lookup_succeeded" != "true" ]]; then
              echo "certificate_defaults_lockdown_needed=unknown" >> "$GITHUB_OUTPUT"
          fi
          echo "firestore_baseline_sha=$firestore_success_sha" >> "$GITHUB_OUTPUT"
          echo "firestore_baseline_mode=$firestore_success_mode" >> "$GITHUB_OUTPUT"
          git merge-base --is-ancestor "$firestore_success_sha" "$last_success_sha"
          git diff --quiet "$firestore_success_sha" "$last_success_sha" -- firestore.rules firestore.indexes.json
          echo "advancing its SHA and forcing live mode classification"
          echo "The protected native-readiness gate can finalize the same"
          firestore_success_sha="$last_success_sha"
          echo "The Firestore component and complete production baselines diverged; forcing authorization rules-first ordering."
          git diff --quiet "$firestore_success_sha" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- storage.rules
      - name: Stage exact Firestore baseline variants
        env:
          FIRESTORE_BASELINE_MODE: \${{ steps.firestore_config.outputs.firestore_baseline_mode }}
          FIRESTORE_BASELINE_SHA: \${{ steps.firestore_config.outputs.firestore_baseline_sha }}
        run: |
          baseline_checkout="$(mktemp -d "$RUNNER_TEMP/firestore-baseline-checkout.XXXXXX")"
          git archive "$FIRESTORE_BASELINE_SHA" | tar -x -C "$baseline_checkout"
          baseline_compactor="$baseline_checkout/scripts/compact-firestore-rules.mjs"
          baseline_transformer="$baseline_checkout/scripts/build-certificate-defaults-compat-rules.mjs"
          baseline_replay_transformer="$baseline_checkout/scripts/build-replay-native-compat-rules.mjs"
          baseline_node_major="$(awk baseline-node "$baseline_checkout/.github/workflows/deploy-prod.yml")"
          current_node_major="$(node -p baseline-node)"
          cd "$baseline_checkout"
          node "scripts/compact-firestore-rules.mjs" "$baseline_source" "$FIREBASE_PRODUCTION_BUNDLE/firestore-baseline.rules"
          node "scripts/build-certificate-defaults-compat-rules.mjs" "$baseline_source" "$baseline_compatibility_source"
          node "scripts/build-replay-native-compat-rules.mjs" "$baseline_source" "$baseline_replay_compatibility_source"
          node "scripts/compact-firestore-rules.mjs" "$baseline_compatibility_source" "$FIREBASE_PRODUCTION_BUNDLE/firestore-baseline-compat.rules"
          echo "A trusted final component marker cannot reference legacy client-writable certificate defaults rules."
          FIRESTORE_BASELINE_MODE="compatibility"
          printf '%s\\n' final > "$FIREBASE_PRODUCTION_BUNDLE/firestore-baseline.mode"
          printf '%s\\n' final > "$FIREBASE_PRODUCTION_BUNDLE/firestore-baseline-replay.mode"
      - name: Deploy Firebase Storage rules when available
        env:
          STORAGE_RULES_CHANGED: \${{ needs.prepare-deploy.outputs.storage_changed }}
        run: |
          node "$firebase_cli" deploy --only storage --project game-flow-c6311 --config "$firebase_config" --non-interactive
          sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' "$storage_log" > "$storage_plain_log"
          if [[ "$STORAGE_RULES_CHANGED" != "true" ]]; then exit 0; fi
          exit "$storage_status"
            transient_pattern='HTTP Error:[[:space:]]*409,[[:space:]]*Requested entity already exists'
            firestore_indexes_config="$FIREBASE_PRODUCTION_BUNDLE/firebase-indexes.generated.json"
            firestore_component_description="Firestore compatibility rules at \${GITHUB_SHA}; packaged native clients still use direct writes."
            jq 'del(.firestore.rules)' "$firebase_config" > "$firestore_indexes_config"
            jq -e 'and (.firestore | has("rules") | not)' "$firestore_indexes_config"
            deploy_config="$firebase_config"
            if [[ "$deploy_targets" == "firestore:indexes" ]]; then
              deploy_config="$firestore_indexes_config"
            fi
            local -a deploy_args=(
              --only "$deploy_targets"
              --project game-flow-c6311
              --config "$deploy_config"
              --non-interactive
            )
            retry_enabled_inventory_producer_target="functions:indexCertificateLegacySignaturesOnDefaultsWrite"
            retry_enabled_cleanup_compatibility_target="functions:cleanupCertificateSignature"
            replay_archive_reader_compatibility_targets="functions:getReplayPrivacyMigrationStatus,functions:manageGameReplayArchive,functions:saveGameHighlightClips,functions:saveAthleteProfileProjection,functions:mutateStructuredMediaIdentity,functions:getGameReplayPlayback,functions:publicHomepageGamesV1,functions:publicTeamGamesV1,functions:getFamilyShareSchedule,functions:getFamilyShareView,functions:getPublicTeamGamesProjection,functions:getPublicTeamCalendarProjection,functions:getPublicGameProjection"
            replay_archive_cleanup_compatibility_targets="functions:cleanupPrivateReplayArchiveOnGameDelete,functions:cleanupPrivateReplayArchiveOnSharedGameDelete"
            replay_public_cache_drain_seconds=330
            retry_enabled_function_targets="functions:cleanupPrivateReplayArchiveOnGameDelete,functions:cleanupPrivateReplayArchiveOnSharedGameDelete,functions:indexCertificateLegacySignaturesOnDefaultsWrite,functions:processAccountDeletionRequest,functions:queueParentInviteEmail,functions:reconcileLegacyTeamOwnership,functions:syncPublicUserProfileOnUserWrite,functions:syncPublicUserProfilesOnTeamWrite,functions:syncTeamOwnerAccessOnCreate,functions:notifyConversationChatMessageCreated,functions:notifyFeeAssigned,functions:notifyFeeMarkedPaid,functions:notifyGameCreated,functions:notifyGameUpdated,functions:notifyInviteRedeemed,functions:notifyLiveEventCreated,functions:notifyOfficiatingNotificationCreated,functions:notifyOpenOfficiatingSlots,functions:notifyParentMembershipRequestCreated,functions:notifyParentMembershipRequestUpdated,functions:notifyPracticePacketAssigned,functions:notifyPracticePacketCompleted,functions:notifyPublishedCertificateAward,functions:notifyRegistrationStatusChanged,functions:notifyRegistrationSubmitted,functions:notifyRideClaimCreated,functions:notifyRideClaimUpdated,functions:notifyRideOfferCancelled,functions:notifyRideOfferCreated,functions:notifyScheduleImportBatchCompleted,functions:notifyTeamChatMessageCreated,functions:syncTeamNotificationTargetsOnDeviceWrite,functions:syncTeamNotificationTargetsOnPreferenceWrite,functions:processPasswordResetEmailRequest,functions:sweepIneligiblePublicUserProfiles,functions:dispatchDueTeamMediaNotificationBatches,functions:dispatchDuePreEventReminders,functions:queueDueRegistrationFailedPaymentReminders,functions:sendPracticePacketDueTomorrowReminders,functions:sendFeeUnpaidDueReminders"
            certificate_compatibility_recovery_ruleset="projects/game-flow-c6311/rulesets/6da601e4-12e3-420a-8db3-907153c712c7"
            certificate_compatibility_recovery_source_sha256="825ec3d3a56a067dc5c80c0e6e6f3fc1ceba2b09b249e0605889dc3d964dc6f2"
            certificate_compatibility_recovery_canonical_sha256="0334471987fba5fbb95f7acf49382e3e412849f02cb2ed333f87249f1674b4de"
            recovery_sha="b637109b4f51d9b8627bb081eaea1489dfc8b8c3"
            recovery_source_sha256="033fc321f5a10457a9093262ff1b8c907aa1a583624a7edf8455804f4f3ba1ef"
            git merge-base --is-ancestor "$recovery_sha" "$GITHUB_SHA"
            git archive "$recovery_sha"
            test -f "$bundle/firestore-active-recovery.rules"
            certificate_active_recovery_ruleset="projects/game-flow-c6311/rulesets/537ed719-d2fa-4cae-9a20-97273db4e11a"
            certificate_active_recovery_source_sha256="033fc321f5a10457a9093262ff1b8c907aa1a583624a7edf8455804f4f3ba1ef"
            certificate_active_recovery_canonical_sha256="033fc321f5a10457a9093262ff1b8c907aa1a583624a7edf8455804f4f3ba1ef"
            active_ruleset_observed_source_sha256="unknown"
            if [[ "$deploy_targets" != "$retry_enabled_function_targets"
              && "$deploy_targets" != "$retry_enabled_inventory_producer_target"
              && "$deploy_targets" != "$retry_enabled_cleanup_compatibility_target"
              && "$deploy_targets" != "$replay_archive_cleanup_compatibility_targets" ]]; then
              echo "Refusing --force outside the reviewed retry-enabled function allowlist."
            fi
            deploy_args+=(--force)
            node "$firebase_cli" deploy "\${deploy_args[@]}"
          env:
            REPLAY_NATIVE_CALLABLE_READY: \${{ vars.REPLAY_NATIVE_CALLABLE_READY }}
            CERTIFICATE_DEFAULTS_NATIVE_CALLABLE_READY: \${{ vars.CERTIFICATE_DEFAULTS_NATIVE_CALLABLE_READY }}
            CERTIFICATE_DEFAULTS_LOCKDOWN_NEEDED: \${{ needs.prepare-deploy.outputs.certificate_defaults_lockdown_needed }}
            FIRESTORE_CONFIG_CHANGED: \${{ needs.prepare-deploy.outputs.firestore_changed }}
          retry_delay_seconds=$((base_delay_seconds * (2 ** (attempt - 1))))
          retry_jitter_seconds=$((RANDOM % 16))
          if (( retry_delay_seconds > 120 )); then
            retry_delay_seconds=120
          fi
          verify_active_firestore_rules() {
            curl "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases/cloud.firestore"
            curl "https://firebaserules.googleapis.com/v1/\${ruleset_name}"
            jq '(.source.files // []) | if length == 1 and .[0].name == "firestore.rules"'
            firestore_ruleset_source_matches "$ruleset_json" "$ruleset_name" "$expected_rules_source"
            return 2
          }
          firestore_ruleset_source_matches() {
            jq '(.source.files // []) | if length == 1 and .[0].name == "firestore.rules"'
            if [[ "$expected_rules_source" == "$active_recovery_firestore_rules" ]]; then
              [[ "$ruleset_name" == "$certificate_active_recovery_ruleset" ]]
              [[ "$local_rules_sha256" == "$certificate_active_recovery_source_sha256" ]]
              [[ "$remote_rules_sha256" == "$certificate_active_recovery_canonical_sha256" ]]
            fi
            [[ "$local_rules_sha256" == "$certificate_compatibility_recovery_source_sha256" ]]
            [[ "$remote_rules_sha256" == "$certificate_compatibility_recovery_canonical_sha256" ]]
          }
          write_unrecognized_active_firestore_rules_evidence() {
            echo "remote_source_sha256=\${active_ruleset_observed_source_sha256}"
            echo "current_compatibility_sha256=\${current_compatibility_sha256}"
            echo "baseline_compatibility_sha256=\${baseline_compatibility_sha256}"
            echo "active_recovery_sha256=\${active_recovery_sha256}"
          }
          find_recent_matching_firestore_ruleset() {
            curl "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/rulesets?pageSize=20"
            jq '(.rulesets // []) | sort_by(.createTime) | reverse | .[].name'
            jq '(.source.files // []) | if length == 1 and .[0].name == "firestore.rules"'
            firestore_ruleset_source_matches "$ruleset_file" "$ruleset_name" "$expected_rules_source"
          }
          create_firestore_ruleset_with_retry() {
            jq --rawfile rules_source firestore.rules --arg rules_fingerprint fingerprint 'fingerprint:$rules_fingerprint'
            for attempt in 1 2 3 4 5 6; do
              curl --request POST "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/rulesets"
              jq '(.source.files // []) | if length == 1 and .[0].name == "firestore.rules"'
              [[ -n "$created_rules_b64" && "$created_rules_b64" == "$local_rules_b64" ]]
              [[ "$created_fingerprint" == "$local_fingerprint" ]]
              firestore_rules_api_error "Firestore ruleset creation"
              if ruleset_name="$(find_recent_matching_firestore_ruleset "$expected_rules_source")"; then
                printf '%s\n' "$ruleset_name"
                return 0
              fi
              retry_delay_seconds=$((15 * (2 ** (attempt - 1))))
              retry_delay_seconds=$((retry_delay_seconds + (RANDOM % 16)))
              if (( retry_delay_seconds > 120 )); then retry_delay_seconds=120; fi
            done
          }
          ensure_exact_firestore_ruleset() {
            find_recent_matching_firestore_ruleset
            create_firestore_ruleset_with_retry
            find_recent_matching_firestore_ruleset
          }
          firestore_rules_api_error() {
            echo "structured Rules API error"
          }
          verify_active_firestore_release_name() {
            curl "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases/cloud.firestore"
          }
          activate_firestore_ruleset_with_retry() {
            [[ "$ruleset_name" =~ ^projects/game-flow-c6311/rulesets/[A-Za-z0-9_-]+$ ]] || return 1
            for attempt in 1 2 3 4 5 6 7 8; do
              curl --request PATCH "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases/cloud.firestore"
              jq 'updateMask:"rulesetName"'
              [[ "$(jq -r '.rulesetName // ""' "$response_file")" == "$ruleset_name" ]]
              firestore_rules_api_error "Firestore release update"
              if verify_active_firestore_release_name "$ruleset_name"; then return 0; fi
              retry_delay_seconds=$((15 * (2 ** (attempt - 1))))
              retry_delay_seconds=$((retry_delay_seconds + (RANDOM % 16)))
              if (( retry_delay_seconds > 120 )); then retry_delay_seconds=120; fi
            done
          }
          write_firestore_configuration_blocked_summary() {
            {
              echo '| Guaranteed not deployed | Full \`hosting\`, \`functions\` application |'
              echo "Exact rules and indexes were not both verified."
              echo "The full application deployment remains fail-closed."
              echo "Recovery: \${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/blob/master/docs/observability-runbook.md#firestore-rules-api-retry-exhaustion"
            } >> "$GITHUB_STEP_SUMMARY"
          }
          write_firestore_finalization_blocked_summary() {
            echo "No client outage was introduced."
          }
          echo 'Set \`REPLAY_NATIVE_CALLABLE_READY=true\` only after every supported installed native version uses \`manageGameReplayArchive\`, \`saveGameHighlightClips\`, \`saveAthleteProfileProjection\`, and \`mutateStructuredMediaIdentity\`, and runs the pre-Firestore \`getReplayPrivacyMigrationStatus\` cache protocol (memory-only before readiness, clear on the ready transition, then mark the returned epoch).'
          active_replay_boundary="$baseline_replay_mode"
          retry_firebase_deploy "$replay_archive_reader_compatibility_targets" "replay-private-archive-reader-compatibility" 3 15
          retry_firebase_deploy "$replay_archive_cleanup_compatibility_targets" "replay-private-archive-cleanup-compatibility" 3 15 true
          if [[ "$replay_native_callable_ready" != "true" ]]; then
            write_replay_native_hold_summary
            exit 2
          fi
          sleep "$replay_public_cache_drain_seconds"
          retry_firebase_deploy "hosting" "replay-callable-client-compatibility" 3 15
          activate_firestore_ruleset_with_retry "$replay_final_ruleset_name" "$replay_final_rules_source"
          verify_active_firestore_rules "$replay_final_rules_source"
          node "$FIREBASE_PRODUCTION_BUNDLE/_migration/backfill-game-replay-archives.mjs" --close-gate
          verify_active_firestore_rules "$replay_final_rules_source"
          node "$FIREBASE_PRODUCTION_BUNDLE/_migration/backfill-game-replay-archives.mjs" --activate-profile-boundary
          node "$FIREBASE_PRODUCTION_BUNDLE/_migration/backfill-game-replay-archives.mjs" --apply
          retry_firebase_deploy "functions:indexCertificateLegacySignaturesOnDefaultsWrite" "certificate-signature-inventory-producer" 3 15
          retry_firebase_deploy "$retry_enabled_cleanup_compatibility_target" "certificate-signature-cleanup-compatibility" 3 15 true
          node "$FIREBASE_PRODUCTION_BUNDLE/_migration/backfill-certificate-legacy-signature-inventory.mjs" --apply
          if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then
            if [[ "$native_callable_ready" == "true" && "$CERTIFICATE_DEFAULTS_LOCKDOWN_NEEDED" == "true" ]]; then
              FIRESTORE_CONFIG_CHANGED="true"
            fi
            if verify_active_firestore_rules "$final_firestore_rules"; then
              echo "The active Firestore rules exactly match this commit; skipping a redundant ruleset write."
            else
              active_rules_variant="baseline-\${baseline_firestore_mode}"
              if [[ "$baseline_firestore_mode" == "ambiguous" ]]; then active_rules_variant="baseline-final"; fi
              active_rules_variant="baseline-compatibility"
              active_rules_variant="historical-compatibility"
              if (( active_rules_status == 2 )); then exit 2; fi
              if [[ -z "$active_rules_variant" ]]; then
                write_unrecognized_active_firestore_rules_evidence
                write_firestore_configuration_blocked_summary "active Firestore rules did not match a trusted final or compatibility baseline"
                exit 2
              fi
              if [[ "$active_rules_variant" == *-final ]]; then
                ensure_exact_firestore_ruleset "$final_firestore_rules"
              fi
              retry_firebase_deploy "functions:commitCertificateDefaults" "certificate-defaults-writer-compatibility" 3 15
              node scripts/build-certificate-defaults-compat-rules.mjs
              test -f "$bundle/firestore-certificate-defaults-compat.rules"
              ensure_exact_firestore_ruleset "$compatibility_firestore_rules"
              activate_firestore_ruleset_with_retry "$compatibility_ruleset_name" "$compatibility_firestore_rules"
              echo "certificate-defaults-rules-compatibility"
              ensure_exact_firestore_ruleset "$final_firestore_rules"
              if [[ "$native_callable_ready" == "true" ]]; then
                finalize_firestore_rules="true"
              else
                echo "Keeping certificate-defaults compatibility rules until supported installed native versions use the callable."
              fi
              echo "currently unavailable projects:test request"
              ensure_exact_firestore_ruleset "$final_firestore_rules"
              activate_firestore_ruleset_with_retry "$final_ruleset_name" "$final_firestore_rules"
              echo "Created or reused and activated the exact staged Firestore ruleset."
            fi
            retry_firebase_deploy "firestore:indexes" "firestore-indexes" 3 15
          else
            :
          fi
          verify_active_firestore_rules "$final_firestore_rules"
          verify_active_firestore_rules "$compatibility_firestore_rules"
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- functions/replay-structured-media-core.cjs
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- functions/structured-media-write-core.cjs
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- functions/athlete-profile-projection-core.cjs
          git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- js/replay-clip-sanitizer.js
          cp --no-dereference js/replay-clip-sanitizer.js "$bundle/js/replay-clip-sanitizer.js"
          (cd "$bundle" && sha256sum -c js/replay-clip-sanitizer.sha256)
          record_component_deployment() {
            echo 'state: "success"'
          }
          record_component_deployment "production-firestore"
          retry_firebase_deploy "$retry_enabled_inventory_producer_target" "certificate-signature-inventory-producer" 3 15 true
          retry_firebase_deploy "$retry_enabled_function_targets" "retry-enabled-functions" 3 15 true
          retry_firebase_deploy "hosting,functions" "application"
          echo "certificate-defaults-rules-final"
        `;

        expect(() => validateProductionDeployCommand(validDeployCommand)).not.toThrow();
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('replay_public_cache_drain_seconds=330', 'replay_public_cache_drain_seconds=60')
        )).toThrow('Production replay public-cache drain exceeds the prior shared-cache TTL');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('          sleep "$replay_public_cache_drain_seconds"\n', '')
        )).toThrow('Production replay migration must stage sanitized readers');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace(
                '          sleep "$replay_public_cache_drain_seconds"\n          retry_firebase_deploy "hosting" "replay-callable-client-compatibility" 3 15',
                '          retry_firebase_deploy "hosting" "replay-callable-client-compatibility" 3 15\n          sleep "$replay_public_cache_drain_seconds"'
            )
        )).toThrow('Production replay migration must stage sanitized readers');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('  workflow_dispatch:', '  pull_request:')
        )).toThrow('Production push and manual retry triggers');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('group: production-deploy-${{ github.ref }}', 'group: production-deploy')
        )).toThrow('Production ref-scoped concurrency');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('baseline_branch="$GITHUB_REF_NAME"', 'baseline_branch="master"')
        )).toThrow('Production push baseline branch');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('if [[ "$GITHUB_REF" != "refs/heads/master" ]]; then', 'if [[ "$GITHUB_REF" != "refs/heads/release" ]]; then')
        )).toThrow('Production manual retry master restriction');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('-f branch="$baseline_branch"', '-f branch="$GITHUB_REF_NAME"')
        )).toThrow('Production successful deploy branch filter');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('"retry-enabled-functions" 3 15 true', '"retry-enabled-functions" 3 15')
        )).toThrow('Production retry-enabled function failure-policy acknowledgement call');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('if [[ "$deploy_targets" != "$retry_enabled_function_targets"', 'if [[ "disabled" == "true"')
        )).toThrow('Production force-deploy scoped function-group allowlist guard');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('&& "$deploy_targets" != "$retry_enabled_inventory_producer_target"', '&& "disabled" == "true"')
        )).toThrow('Production force-deploy scoped inventory-producer allowlist guard');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('&& "$deploy_targets" != "$retry_enabled_cleanup_compatibility_target"', '&& "disabled" == "true"')
        )).toThrow('Production force-deploy scoped cleanup allowlist guard');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('&& "$deploy_targets" != "$replay_archive_cleanup_compatibility_targets" ]]; then', '&& "disabled" == "true" ]]; then')
        )).toThrow('Production force-deploy scoped replay cleanup allowlist guard');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('"certificate-signature-cleanup-compatibility" 3 15 true', '"certificate-signature-cleanup-compatibility" 3 15')
        )).toThrow('Production retry-enabled cleanup compatibility failure-policy acknowledgement call');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('              --project game-flow-c6311\n', '')
        )).toThrow('Production Firebase deploy project');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('            deploy_config="$firebase_config"\n', '')
        )).toThrow('Production Firebase generated config default');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace(
                'firestore_indexes_config="$FIREBASE_PRODUCTION_BUNDLE/firebase-indexes.generated.json"',
                'firestore_indexes_config="$RUNNER_TEMP/firebase-indexes.generated.json"'
            )
        )).toThrow('Production Firestore indexes config beside staged indexes');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace(
                "            jq 'del(.firestore.rules)' \"$firebase_config\" > \"$firestore_indexes_config\"\n",
                ''
            )
        )).toThrow('Production Firestore indexes config removes the rules target');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace('              deploy_config="$firestore_indexes_config"', '              deploy_config="$firebase_config"')
        )).toThrow('Production Firestore indexes deploy uses the rules-free config');
        expect(() => validateProductionDeployCommand(
            validDeployCommand.replace(
                'git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- storage.rules',
                'git diff --quiet "\${{ github.event.before }}" "\${{ github.sha }}" -- storage.rules'
            )
        )).toThrow('Production Storage rules successful-deploy baseline');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace('[[ "$STORAGE_RULES_CHANGED" != "true" ]]', '[[ true ]]'))).toThrow(
            'Production Storage rules unchanged-only skip'
        );
        expect(() => validateProductionDeployCommand(validDeployCommand.replace("sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' \"$storage_log\" > \"$storage_plain_log\"", ''))).toThrow(
            'Production Storage rules ANSI log normalization'
        );
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'git diff --quiet "$firestore_success_sha" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json',
            'git diff --quiet "\${{ github.event.before }}" "\${{ github.sha }}" -- firestore.rules firestore.indexes.json'
        ))).toThrow('Production Firestore component change detection is missing');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'if last_success_run_json="$(gh api',
            'last_success_run_json="$(gh api'
        ))).toThrow('Production successful deploy guarded lookup is missing');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'echo "changed=true" >> "$GITHUB_OUTPUT"',
            'echo "changed=false" >> "$GITHUB_OUTPUT"'
        ))).toThrow('Production successful deploy lookup failure must force authorization rules-first ordering');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'echo "storage_changed=true" >> "$GITHUB_OUTPUT"',
            'echo "storage_changed=false" >> "$GITHUB_OUTPUT"'
        ))).toThrow('Production successful deploy lookup failure must force authorization rules-first ordering');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'HTTP Error:[[:space:]]*409,[[:space:]]*Requested entity already exists',
            '(^|[^[:alnum:]])409([^[:alnum:]]|$)'
        ))).toThrow('Production Firestore release-race retry');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'echo \'| Guaranteed not deployed | Full `hosting`, `functions` application |\'',
            'echo "Deployment blocked"'
        ))).toThrow('Production Firestore retry-exhaustion blocked application surfaces');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'Exact rules and indexes were not both verified.',
            'Rules and indexes were not deployed.'
        ))).toThrow('Production Firestore retry-exhaustion exact-state status');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            '${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/blob/master/docs/observability-runbook.md#firestore-rules-api-retry-exhaustion',
            'docs/observability-runbook.md'
        ))).toThrow('Production Firestore retry-exhaustion recovery link');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `ensure_exact_firestore_ruleset`,
            `retry_firebase_deploy "hosting,functions" "application"
            ensure_exact_firestore_ruleset`
        ))).toThrow('Production certificate defaults must deploy inventory producer, revalidating cleanup consumer, backfill, writer, transitional rules, callers, then the final denial');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'retry_firebase_deploy "firestore:indexes" "firestore-indexes" 3 15',
            'retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore-indexes" 3 15'
        ))).toThrow('Production Firestore exact-source indexes-only deploy');
        expect(() => validateProductionDeployCommand(validDeployCommand.replaceAll(
            'if length == 1 and .[0].name == "firestore.rules"',
            'if any(.[]; .name == "firestore.rules")'
        ))).toThrow('Production Firestore active, reused, and created sources must contain only firestore.rules');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'firestore_ruleset_source_matches "$ruleset_file" "$ruleset_name" "$expected_rules_source"',
            'true'
        ))).toThrow('Production Firestore recent-ruleset verified-source comparison');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            '[[ -n "$created_rules_b64" && "$created_rules_b64" == "$local_rules_b64" ]]',
            '[[ -n "$created_rules_b64" ]]'
        ))).toThrow('Production Firestore created-ruleset exact-source comparison');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            '[[ "$created_fingerprint" == "$local_fingerprint" ]]',
            '[[ -n "$created_fingerprint" ]]'
        ))).toThrow('Production Firestore created-ruleset fingerprint comparison');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'fingerprint:$rules_fingerprint',
            'fingerprint:""'
        ))).toThrow('Production Firestore ruleset source fingerprint field');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            '[[ "$local_rules_sha256" == "$certificate_compatibility_recovery_source_sha256" ]]',
            '[[ -n "$local_rules_sha256" ]]'
        ))).toThrow('Production Firestore compatibility recovery local-source proof');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            '[[ "$remote_rules_sha256" == "$certificate_compatibility_recovery_canonical_sha256" ]]',
            '[[ -n "$remote_rules_sha256" ]]'
        ))).toThrow('Production Firestore compatibility recovery canonical-source proof');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'remote_source_sha256=${active_ruleset_observed_source_sha256}',
            'active_rules_source=redacted'
        ))).toThrow('Production Firestore redacted active-source digest evidence');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'verify_active_firestore_release_name "$ruleset_name"',
            'verify_active_firestore_rules "$expected_rules_source"'
        ))).toThrow('Production Firestore immutable release-name verification');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'curl --request POST "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/rulesets"',
            'curl --request POST "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases"'
        ))).toThrow('Production Firestore ruleset create endpoint');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'curl --request PATCH "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases/cloud.firestore"',
            'curl --request POST "https://firebaserules.googleapis.com/v1/projects/game-flow-c6311/releases"'
        ))).toThrow('Production Firestore release PATCH method');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            'currently unavailable projects:test request',
            'test_firestore_rules_api 2 20'
        ))).toThrow('Production must not depend on Firebase CLI projects:test before ruleset creation');
        expect(() => validateProductionDeployCommand(validDeployCommand.replace(
            `else
            :
          fi`,
            `else
            retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore" 5 20
          fi`
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
