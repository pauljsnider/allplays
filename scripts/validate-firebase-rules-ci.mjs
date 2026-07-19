import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

function readText(path) {
    return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertIncludes(text, expected, label) {
    if (!text.includes(expected)) {
        throw new Error(`${label} is missing: ${expected}`);
    }
}

function assertMatches(text, pattern, label) {
    if (!pattern.test(text)) {
        throw new Error(`${label} did not match ${pattern}`);
    }
}

function assertEquals(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label} expected ${expected} but got ${actual}`);
    }
}

function canDeleteOwnScopedStorageUpload({ authUid, pathUserId, isTeamAdmin = false, hasCurrentScopeAccess = false }) {
    return authUid !== null &&
        (isTeamAdmin ||
            (authUid === pathUserId && hasCurrentScopeAccess));
}

export function assertPreviewDeploySkipHandling(deployPreview) {
    assertIncludes(deployPreview, 'preview_deploy_hit_release_target_error()', 'Preview deploy release target error handling');
    assertIncludes(deployPreview, "HTTP Error: 400, Can't release to .*resource doesn't exist or isn't a valid release target", 'Preview deploy release target error classifier');
    assertIncludes(deployPreview, 'preview_skip_reason=', 'Preview deploy skipped reason output');
    assertIncludes(deployPreview, 'skip_preview_for_release_target', 'Preview deploy release target skip');
    assertIncludes(deployPreview, 'PREVIEW_SKIP_REASON: ${{ needs.deploy-preview.outputs.preview_skip_reason }}', 'Preview deploy skipped reason PR comment');
}

export function extractMatchBlock(text, startMarker) {
    const start = text.indexOf(startMarker);
    if (start === -1) {
        throw new Error(`Rule block is missing: ${startMarker}`);
    }

    const remainingText = text.slice(start);
    const nextMatch = remainingText.indexOf('\n    match /', startMarker.length);
    return nextMatch === -1 ? remainingText : remainingText.slice(0, nextMatch);
}

export function validatePreviewDeployCommand(deployPreview) {
    if (/hosting:channel:deploy[^\n]*--site/.test(deployPreview)) {
        throw new Error('Preview deploy must not pass --site to hosting:channel:deploy; firebase-tools 15 rejects that option.');
    }
    if (/hosting:channel:deploy[^\n]*--no-authorized-domains/.test(deployPreview)) {
        throw new Error('Preview deploy must preserve Firebase Auth authorized-domain synchronization.');
    }
    assertMatches(deployPreview, /node "\$firebase_cli" hosting:channel:deploy "\$CURRENT_CHANNEL" --project game-flow-c6311 --config "\$firebase_config"/, 'Preview deploy installed Firebase CLI project/config arguments');
    assertIncludes(deployPreview, 'preview_deploy_hit_auth_domain_sync_error()', 'Preview deploy Auth-domain sync failure guard');
    assertIncludes(deployPreview, 'refusing to report a partially functional preview', 'Preview deploy Auth-domain fail-closed message');
}

export function validateFirebaseDeployWorkloadIdentity(workflow, label) {
    let parsed;
    try {
        parsed = parseYaml(workflow);
    } catch (error) {
        throw new Error(`${label} workflow YAML is invalid: ${error.message}`);
    }

    const objects = [];
    const scalarStrings = [];
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            objects.push(value);
            for (const child of Object.values(value)) visit(child);
            return;
        }
        if (typeof value === 'string') scalarStrings.push(value);
    };
    visit(parsed);

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? Object.values(parsed.jobs) : [];
    const oidcJobs = jobs.filter((job) => job?.permissions?.['id-token'] === 'write');
    if (oidcJobs.length === 0) {
        throw new Error(`${label} OIDC token permission is missing: id-token: write`);
    }

    for (const job of oidcJobs) {
        const jobText = JSON.stringify(job);
        if (/npm (?:ci|install)|stage-pages-bundle|extract-preview-hosting-artifact|write-firebase-hosting-config|actions\/artifacts\/[^/]+\/zip/.test(jobText)) {
            throw new Error(`${label} dependency, build, and raw-artifact preparation must run in a separate no-OIDC job.`);
        }
        if (!Array.isArray(job.steps)) {
            throw new Error(`${label} credentialed deploy job has no valid step list.`);
        }
        if (job.steps.some((step) => typeof step?.uses === 'string' &&
            !/^actions\/download-artifact@[0-9a-f]{40}$/.test(step.uses) &&
            !/^google-github-actions\/auth@/.test(step.uses)
        )) {
            throw new Error(`${label} credentialed deploy job contains an unapproved action.`);
        }
        if (!job.steps.some((step) =>
            typeof step.uses === 'string' && /^actions\/download-artifact@[0-9a-f]{40}$/.test(step.uses)
        )) {
            throw new Error(`${label} credentialed deploy job must consume only a pinned trusted handoff artifact.`);
        }
    }

    for (const job of jobs) {
        if (!Array.isArray(job?.steps)) continue;
        const hasPreparation = job.steps.some((step) => typeof step?.run === 'string' &&
            /npm (?:ci|install)|stage-pages-bundle|extract-preview-hosting-artifact|write-firebase-hosting-config/.test(step.run)
        );
        if (hasPreparation && job.permissions?.['id-token'] === 'write') {
            throw new Error(`${label} no-OIDC preparation boundary is missing.`);
        }
    }

    const authSteps = objects.filter((value) =>
        typeof value.uses === 'string' && value.uses.startsWith('google-github-actions/auth@')
    );
    if (authSteps.length === 0 || authSteps.some((step) =>
        !/^google-github-actions\/auth@[0-9a-f]{40}$/.test(step.uses)
    )) {
        throw new Error(`${label} pinned Google authentication action did not match an exact commit.`);
    }

    for (const step of authSteps) {
        const inputs = step.with || {};
        if (inputs.workload_identity_provider !== '${{ vars.FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER }}') {
            throw new Error(`${label} workload identity provider variable is missing or changed.`);
        }
        if (inputs.service_account !== '${{ vars.FIREBASE_DEPLOY_SERVICE_ACCOUNT }}') {
            throw new Error(`${label} service account variable is missing or changed.`);
        }
        if (inputs.project_id !== 'game-flow-c6311') {
            throw new Error(`${label} Firebase project binding is missing or changed.`);
        }
        if (inputs.create_credentials_file !== true) {
            throw new Error(`${label} ADC credential file must be enabled.`);
        }
        if (inputs.cleanup_credentials !== true) {
            throw new Error(`${label} credential cleanup must be enabled.`);
        }
    }

    let deployStepCount = 0;
    for (const object of objects) {
        if (!Array.isArray(object.steps)) continue;
        for (let index = 0; index < object.steps.length; index += 1) {
            const step = object.steps[index];
            if (!step || typeof step.run !== 'string' ||
                !/(?:firebase-tools@\S+|(?:^|\/)firebase|node\s+"\$firebase_cli")\s+(?:hosting:channel:)?deploy\b/m.test(step.run)) {
                continue;
            }
            deployStepCount += 1;
            const maxTimeoutMinutes = label === 'Production deploy' &&
                step.name === 'Deploy Firebase production'
                ? 20
                : 4;
            if (!Number.isInteger(step['timeout-minutes']) ||
                step['timeout-minutes'] < 1 ||
                step['timeout-minutes'] > maxTimeoutMinutes) {
                throw new Error(`${label} credentialed deploy step ${step.name || '(unnamed)'} must have a timeout from one to ${maxTimeoutMinutes} minutes.`);
            }
            const authStep = object.steps[index - 1];
            if (!authStep || typeof authStep.uses !== 'string' ||
                !/^google-github-actions\/auth@[0-9a-f]{40}$/.test(authStep.uses)) {
                throw new Error(`${label} must authenticate immediately before each Firebase deploy step.`);
            }

            const npxCli = step.run.match(/npx\s+(firebase-tools@[^\s]+)\s+deploy\b/);
            if (npxCli) {
                const primedBeforeAuth = object.steps.slice(0, index - 1).some((candidate) =>
                    typeof candidate?.run === 'string' &&
                    candidate.run.includes(`npx ${npxCli[1]} --version`)
                );
                if (!primedBeforeAuth) {
                    throw new Error(`${label} must resolve the exact Firebase CLI before requesting OIDC.`);
                }
            }
        }
    }
    if (deployStepCount === 0) {
        throw new Error(`${label} Firebase deploy step is missing.`);
    }

    const forbiddenMappingKeys = new Set([
        'cloudsdk_auth_credential_file_override',
        'credentials_json',
        'firebase_deploy_token',
        'firebase_token',
        'google_application_credentials',
        'google_credentials',
        'google_gha_creds_path'
    ]);
    for (const object of objects) {
        for (const key of Object.keys(object)) {
            const normalizedKey = key.trim().toLowerCase();
            if (forbiddenMappingKeys.has(normalizedKey) || /^firebase[a-z0-9_]*token$/.test(normalizedKey)) {
                throw new Error(`${label} must not use a long-lived Google service-account key or static ADC input.`);
            }
        }
    }

    const scalarPolicyText = scalarStrings
        // Bash removes an escaped physical newline before parsing tokens. Do
        // the same before policy matching so `--\\\ntoken` and split env names
        // cannot hide a forbidden credential path across workflow lines.
        .flatMap((value) => value.replace(/\\\r?\n/g, '').split('\n'))
        .filter((line) => !/^\s*echo\s+["'](?:CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GHA_CREDS_PATH)=["']\s*$/.test(line))
        .join('\n');
    // Shell concatenates adjacent quoted and unquoted word fragments. Mirror
    // that behavior for environment-like identifiers so constructs such as
    // GOOGLE_"APPLICATION"_CREDENTIALS cannot bypass the static-key guard.
    const normalizedCredentialPolicyText = scalarPolicyText
        .replace(/(["'])([A-Z0-9_]*)\1/gi, '$2')
        .replace(/(?<=[A-Z0-9_])["'](?=[A-Z0-9_])/gi, '');
    const forbiddenScalarPatterns = [
        /\bsecrets\b/i,
        /CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE/i,
        /credentials[\s_-]*json\s*:/i,
        /\bFIREBASE[A-Z0-9_]*TOKEN\b/i,
        /\bFIREBASE_[^\n]{0,64}TOKEN\b/i,
        /GOOGLE_APPLICATION_CREDENTIALS/i,
        /GOOGLE_GHA_CREDS_PATH/i,
        /gcloud\s+auth\s+activate-service-account/i,
        /--key-file(?:=|\s)/i,
        /--token(?:=|\s)/i,
        /secrets\.[A-Z0-9_]*FIREBASE[A-Z0-9_]*TOKEN/i,
        /secrets\.[A-Z0-9_]*(?:SERVICE_ACCOUNT|GOOGLE[^\s}]*(?:KEY|CREDENTIAL))/i,
        /["']?type["']?\s*:\s*["']service_account["']/i
    ];
    if (forbiddenScalarPatterns.some((pattern) => pattern.test(normalizedCredentialPolicyText))) {
        throw new Error(`${label} must not use a long-lived Google service-account key or static ADC input.`);
    }
}

export function validateProductionDeployCommand(deployProd) {
    const deployCommands = Array.from(deployProd.matchAll(/^\s*(?:npx firebase-tools@\S+|node "\$firebase_cli") deploy\b[^\n]*$/gm), match => match[0]);
    const deployCommand = deployCommands.find(command => /--only(?:=|\s+)"\$deploy_targets"/.test(command)) || '';
    if (!deployCommand) {
        throw new Error('Production Firebase deploy command is missing.');
    }

    assertIncludes(deployProd, 'retry_firebase_deploy "hosting,functions" "application"', 'Production application deploy targets');
    assertIncludes(deployProd, 'retry_firebase_deploy "firestore:rules,firestore:indexes" "firestore"', 'Production Firestore deploy targets');
    assertIncludes(deployProd, 'HTTP Error:[[:space:]]*409,[[:space:]]*Requested entity already exists', 'Production Firestore release-race retry');
    assertIncludes(deployProd, 'actions: read', 'Production workflow-run read permission');
    assertIncludes(deployProd, 'GH_TOKEN: ${{ github.token }}', 'Production workflow-run authentication');
    assertIncludes(deployProd, 'actions/workflows/deploy-prod.yml/runs', 'Production successful deploy lookup');
    assertIncludes(deployProd, '-f branch="$GITHUB_REF_NAME"', 'Production successful deploy branch filter');
    assertIncludes(deployProd, '-f status=success', 'Production successful deploy filter');
    assertIncludes(deployProd, 'for ((lookup_attempt = 1; lookup_attempt <= lookup_max_attempts; lookup_attempt += 1)); do', 'Production successful deploy lookup retries');
    assertIncludes(deployProd, 'if last_success_sha="$(gh api', 'Production successful deploy guarded lookup');
    assertIncludes(deployProd, 'if [[ "$lookup_succeeded" != "true" ]]; then', 'Production successful deploy lookup failure fallback');
    assertIncludes(deployProd, 'The successful production deploy lookup failed; forcing Firestore-first ordering.', 'Production successful deploy lookup warning');
    const lookupFallbackStart = deployProd.indexOf('if [[ "$lookup_succeeded" != "true" ]]; then');
    const baselineValidationStart = deployProd.indexOf('if [[ ! "$last_success_sha" =~', lookupFallbackStart);
    const lookupFallback = deployProd.slice(lookupFallbackStart, baselineValidationStart);
    if (!lookupFallback.includes('echo "changed=true" >> "$GITHUB_OUTPUT"') || !lookupFallback.includes('exit 0')) {
        throw new Error('Production successful deploy lookup failure must force Firestore-first ordering.');
    }
    assertIncludes(deployProd, 'git diff --quiet "$last_success_sha" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json', 'Production Firestore change detection');
    if (deployProd.includes('git diff --quiet "${{ github.event.before }}" "${{ github.sha }}" -- firestore.rules firestore.indexes.json')) {
        throw new Error('Production Firestore changes must not use the immediately previous push as the deploy baseline.');
    }
    assertIncludes(deployProd, 'FIRESTORE_CONFIG_CHANGED: ${{ needs.prepare-deploy.outputs.firestore_changed }}', 'Production Firestore change output');
    assertIncludes(deployProd, 'if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then', 'Production Firestore change ordering');
    const changedBranchStart = deployProd.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then');
    const unchangedBranchStart = deployProd.indexOf('\n          else', changedBranchStart);
    const conditionalEnd = deployProd.indexOf('\n          fi', unchangedBranchStart);
    const changedBranch = deployProd.slice(changedBranchStart, unchangedBranchStart);
    const unchangedBranch = deployProd.slice(unchangedBranchStart, conditionalEnd);
    if (changedBranch.indexOf('"firestore"') > changedBranch.indexOf('"application"')) {
        throw new Error('Production Firestore deploy must run first when its configuration changed.');
    }
    if (!unchangedBranch.includes('"application"')) {
        throw new Error('Production application deploy is missing when Firestore configuration is unchanged.');
    }
    if (unchangedBranch.includes('"firestore"')) {
        throw new Error('Production must not redeploy unchanged Firestore configuration.');
    }

    const storageDeployCommand = deployCommands.find(command => /--only(?:=|\s+)storage(?:\s|$)/.test(command)) || '';
    assertMatches(storageDeployCommand, /--project game-flow-c6311(?:\s|$)/, 'Production Storage rules deploy project');
    assertMatches(storageDeployCommand, /--config "\$firebase_config"(?:\s|$)/, 'Production Storage rules generated config');
    assertIncludes(deployProd, 'fetch-depth: 0', 'Production Storage rules change history');
    assertIncludes(deployProd, 'git diff --quiet "${{ github.event.before }}" "${{ github.sha }}" -- storage.rules', 'Production Storage rules change detection');
    assertIncludes(deployProd, 'STORAGE_RULES_CHANGED: ${{ needs.prepare-deploy.outputs.storage_changed }}', 'Production Storage rules change output');
    assertIncludes(deployProd, "sed -E 's/\\x1B\\[[0-9;]*[[:alpha:]]//g' \"$storage_log\" > \"$storage_plain_log\"", 'Production Storage rules ANSI log normalization');
    assertIncludes(deployProd, '[[ "$STORAGE_RULES_CHANGED" != "true" ]]', 'Production Storage rules unchanged-only skip');
    assertIncludes(deployProd, 'exit "$storage_status"', 'Production Storage rules changed failure');
    assertMatches(deployCommand, /(?:^|\s)--project game-flow-c6311(?:\s|$)/, 'Production Firebase deploy project');
    assertMatches(deployCommand, /(?:^|\s)--config "\$firebase_config"(?:\s|$)/, 'Production Firebase generated config');
}

export function validateFirebaseRulesCi() {
    const firebaseJson = JSON.parse(readText('firebase.json'));
    const firestoreIndexes = JSON.parse(readText('firestore.indexes.json'));
    const firestoreRules = readText('firestore.rules');
    const storageRules = readText('storage.rules');
    const teamMediaRules = extractMatchBlock(storageRules, 'match /team-media/{teamId}/{folderId}/{userId}/{fileName}');
    const chatFallbackRules = extractMatchBlock(storageRules, 'match /stat-sheets/team-chat/{teamId}/{conversationId}/{userId}/{fileName}');
    const legacyChatFallbackRules = extractMatchBlock(storageRules, 'match /stat-sheets/team-chat/{teamId}/{userId}/{fileName}');
    const statSheetFallbackRules = extractMatchBlock(storageRules, 'match /stat-sheets/team-games/{teamId}/{userId}/{fileName}');
    const drillFallbackRules = extractMatchBlock(storageRules, 'match /stat-sheets/drills/{teamId}/{drillId}/{userId}/{fileName}');
    const clipFallbackRules = extractMatchBlock(storageRules, 'match /game-clips/{teamId}/{gameId}/{userId}/{fileName}');
    const legacyGameClipRules = extractMatchBlock(storageRules, 'match /game-clips/{fileName} {');
    const athleteProfileMediaRules = extractMatchBlock(storageRules, 'match /athlete-profile-media/{userId}/{profileId}/{fileName}');
    const collectionGroupGamesHelper = (firestoreRules.match(/function canReadCollectionGroupGameDocument\(teamPath, data\) \{[\s\S]*?\n\s*}/) || [''])[0];
    const gameEventsRules = (firestoreRules.match(/match \/events\/\{eventId} \{[\s\S]*?\n\s*}/) || [''])[0];
    const aggregatedStatsRules = (firestoreRules.match(/match \/aggregatedStats\/\{statId} \{[\s\S]*?\n\s*}/) || [''])[0];
    const deployProd = readText('.github/workflows/deploy-prod.yml');
    const deployPreviewBuild = readText('.github/workflows/deploy-preview.yml');
    const deployPreviewTrusted = readText('.github/workflows/deploy-preview-trusted.yml');
    const regressionGuards = readText('.github/workflows/regression-guards.yml');

    if (firebaseJson.firestore?.rules !== 'firestore.rules') {
        throw new Error('firebase.json must deploy firestore.rules.');
    }

    if (firebaseJson.firestore?.indexes !== 'firestore.indexes.json') {
        throw new Error('firebase.json must deploy firestore.indexes.json.');
    }
    const authEmailDeliveryTtl = (firestoreIndexes.fieldOverrides || []).some((override) =>
        override.collectionGroup === 'authEmailDeliveries' &&
        override.fieldPath === 'expiresAt' &&
        override.ttl === true
    );
    if (!authEmailDeliveryTtl) {
        throw new Error('Authentication email deliveries must keep an expiresAt TTL policy.');
    }

    if (firebaseJson.storage?.rules !== 'storage.rules') {
        throw new Error('firebase.json must deploy storage.rules.');
    }

    assertIncludes(firestoreRules, 'match /mediaFolders/{folderId}', 'Firestore media folder rules');
    assertIncludes(firestoreRules, 'match /mediaItems/{itemId}', 'Firestore media item rules');
    assertIncludes(firestoreRules, 'function canReadTeamMediaFolder(teamId, folderData)', 'Firestore media folder visibility rules');
    assertIncludes(firestoreRules, 'function canReadTeamMediaItem(teamId, itemData)', 'Firestore media item visibility rules');
    assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaFolder(teamId, resource.data);', 'Firestore media folder read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaItem(teamId, resource.data);', 'Firestore media item read rules');
    assertIncludes(firestoreRules, 'function canReadGameDocument(teamId, gameId, data)', 'Firestore game visibility helper');
    assertIncludes(firestoreRules, 'function canReadGameSubcollectionDocument(teamId, gameId)', 'Firestore game subcollection visibility helper');
    assertIncludes(firestoreRules, 'function canReadCollectionGroupGameDocument(teamPath, data)', 'Firestore collection-group game visibility helper');
    assertIncludes(collectionGroupGamesHelper, 'let parentTeamPath = /databases/$(database)/documents/$(teamPath);', 'Firestore collection-group team path reuse');
    assertIncludes(collectionGroupGamesHelper, 'let parentTeam = get(parentTeamPath).data;', 'Firestore collection-group parent team lookup reuse');
    assertIncludes(collectionGroupGamesHelper, 'return parentTeam != null &&', 'Firestore collection-group parent team existence guard');
    if ((collectionGroupGamesHelper.match(/get\(parentTeamPath\)/g) || []).length !== 1) {
        throw new Error('Firestore collection-group game visibility helper must resolve the parent team document exactly once.');
    }
    if (collectionGroupGamesHelper.includes('exists(parentTeamPath)')) {
        throw new Error('Firestore collection-group game visibility helper must not re-read the parent team document with exists(parentTeamPath).');
    }
    assertIncludes(firestoreRules, 'allow read: if canReadGameDocument(teamId, gameId, resource.data);', 'Firestore team game read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadGameSubcollectionDocument(teamId, gameId);', 'Firestore game subcollection read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadCollectionGroupGameDocument(path, resource.data);', 'Firestore collection-group game read rules');
    if (gameEventsRules.includes('allow read: if true;')) {
        throw new Error('Firestore game events read rules must not allow unconditional public reads.');
    }
    if (aggregatedStatsRules.includes('allow read: if true;')) {
        throw new Error('Firestore aggregated stats read rules must not allow unconditional public reads.');
    }
    assertIncludes(firestoreRules, 'function canManageTeamMedia(teamId)', 'Firestore team media manager helper');
    assertIncludes(firestoreRules, "teamPermission(teamId, 'teamMediaManagement').get('mode', '') == 'selected'", 'Firestore team media manager selected permission');
    assertIncludes(firestoreRules, "request.auth.uid in teamPermission(teamId, 'teamMediaManagement').get('memberIds', [])", 'Firestore team media manager member ID check');
    assertIncludes(firestoreRules, 'allow create, delete: if canManageTeamMedia(teamId);', 'Firestore media folder create/delete rules');
    assertIncludes(firestoreRules, 'allow update: if canManageTeamMedia(teamId) || isTeamMediaUploadCounterUpdate(teamId);', 'Firestore media folder update rules');
    assertIncludes(firestoreRules, 'allow create: if canManageTeamMedia(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);', 'Firestore media item create rules');
    assertIncludes(firestoreRules, 'allow update: if canManageTeamMedia(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);', 'Firestore media item update rules');
    assertIncludes(firestoreRules, 'allow delete: if canManageTeamMedia(teamId);', 'Firestore media item delete rules');
    assertIncludes(firestoreRules, 'match /adminBilling/{billingId}', 'Firestore team fee admin billing rules');
    assertIncludes(firestoreRules, 'allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore team fee admin billing admin-only rules');
    assertIncludes(firestoreRules, 'match /rsvpNotes/{rsvpId}', 'Firestore restricted RSVP note rules');
    assertIncludes(firestoreRules, 'function isRsvpStatusPayloadSafe(data)', 'Firestore RSVP status note exclusion helper');
    assertIncludes(firestoreRules, 'allow get: if (resource == null && isOwnRsvpNoteId() && isParentForTeam(teamId)) ||', 'Firestore missing own RSVP note read rules');
    assertIncludes(firestoreRules, 'canReadRsvpNote(teamId, resource.data);', 'Firestore existing RSVP note read rules');
    assertIncludes(firestoreRules, 'allow list: if canReadRsvpNote(teamId, resource.data);', 'Firestore restricted RSVP note list rules');
    assertIncludes(firestoreRules, 'function isNestedChatMessageCreateValid(teamId, conversationId, conversationData, data)', 'Nested chat message payload validator');
    assertIncludes(firestoreRules, 'function isNestedChatMessageTargetValid(teamId, conversationId, conversationData, data)', 'Nested chat message target validator');
    assertIncludes(firestoreRules, 'function hasValidNestedChatAttachments(teamId, conversationId, data)', 'Nested chat attachment validator');
    assertIncludes(firestoreRules, 'data.createdAt == request.time', 'Nested chat server timestamp binding');
    assertIncludes(firestoreRules, 'data.senderEmail.lower() == request.auth.token.email.lower()', 'Nested chat sender email binding');
    assertIncludes(firestoreRules, "data.recipientIds == conversationData.get('participantIds', [])", 'Nested chat conversation participant binding');
    assertIncludes(firestoreRules, 'isNestedChatMessageCreateValid(', 'Nested chat create rules');

    validateProductionDeployCommand(deployProd);
    validateFirebaseDeployWorkloadIdentity(deployProd, 'Production deploy');
    assertMatches(deployProd, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Production deploy gate');

    assertMatches(deployPreviewBuild, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Preview artifact build gate');
    validatePreviewDeployCommand(deployPreviewTrusted);
    validateFirebaseDeployWorkloadIdentity(deployPreviewTrusted, 'Trusted preview deploy');
    assertPreviewDeploySkipHandling(deployPreviewTrusted);

    assertIncludes(storageRules, 'match /game-clips/{teamId}/{gameId}/{userId}/{fileName}', 'Scoped Storage game clip rules');
    assertIncludes(storageRules, 'allow get: if canAccessTeamMedia(teamId);', 'Scoped Storage game clip read rules');
    assertIncludes(storageRules, 'function isVerifiedForSensitiveWrite()', 'Staged Storage verified-email policy helper');
    assertIncludes(storageRules, 'allow create: if isVerifiedForSensitiveWrite() &&\n        canAccessTeamMedia(teamId) &&', 'Scoped Storage game clip create rules');
    assertIncludes(storageRules, 'request.auth.uid == userId', 'Scoped Storage uploader match rules');
    assertIncludes(storageRules, 'request.resource.contentType.matches(\'video/.*\')', 'Scoped Storage video content-type rules');
    assertIncludes(storageRules, 'function canDeleteOwnTeamMediaObject(teamId, folderId, userId)', 'Team media scoped Storage delete helper');
    assertIncludes(storageRules, 'function canDeleteOwnChatAttachment(teamId, conversationId, userId)', 'Chat fallback scoped Storage delete helper');
    assertIncludes(storageRules, 'function canDeleteOwnTeamScopedUpload(teamId, userId)', 'Team scoped Storage delete helper');
    assertIncludes(storageRules, '(hasTeamMediaUploadGrant(teamId) && canUploadTeamMediaFolder(teamId, folderId))', 'Team media current upload grant delete scope');
    assertIncludes(storageRules, 'function canManageTeamMedia(teamId)', 'Storage team media manager helper');
    assertIncludes(storageRules, "teamPermission(teamId, 'teamMediaManagement').get('mode', '') == 'selected'", 'Storage team media manager selected permission');
    assertIncludes(storageRules, "request.auth.uid in teamPermission(teamId, 'teamMediaManagement').get('memberIds', [])", 'Storage team media manager member ID check');
    assertIncludes(teamMediaRules, 'allow delete: if isVerifiedForSensitiveWrite() &&\n        (canManageTeamMedia(teamId) || canDeleteOwnTeamMediaObject(teamId, folderId, userId));', 'Team media scoped Storage delete rules');
    assertIncludes(chatFallbackRules, 'allow delete: if (isVerifiedForSensitiveWrite() && isTeamOwnerOrAdmin(teamId)) ||\n        canDeleteOwnChatAttachment(teamId, conversationId, userId);', 'Chat fallback scoped Storage delete rules');
    for (const [label, block] of [
        ['Legacy chat fallback scoped Storage delete rules', legacyChatFallbackRules],
        ['Stat sheet scoped Storage delete rules', statSheetFallbackRules],
        ['Drill scoped Storage delete rules', drillFallbackRules],
        ['Game clip scoped Storage delete rules', clipFallbackRules]
    ]) {
        assertIncludes(block, 'allow delete: if isVerifiedForSensitiveWrite() &&\n        (isTeamOwnerOrAdmin(teamId) || canDeleteOwnTeamScopedUpload(teamId, userId));', label);
    }
    for (const [label, block] of [
        ['Team media Storage delete rule', teamMediaRules],
        ['Chat fallback Storage delete rule', chatFallbackRules],
        ['Legacy chat fallback Storage delete rule', legacyChatFallbackRules],
        ['Stat sheet Storage delete rule', statSheetFallbackRules],
        ['Drill Storage delete rule', drillFallbackRules],
        ['Game clip Storage delete rule', clipFallbackRules]
    ]) {
        if (block.includes('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;')) {
            throw new Error(`${label} must not use bare uploader UID deletes without current scope access.`);
        }
    }
    assertEquals(canDeleteOwnScopedStorageUpload({
        authUid: 'uploader-1',
        pathUserId: 'uploader-1',
        hasCurrentScopeAccess: true
    }), true, 'Current uploader Storage delete case');
    assertEquals(canDeleteOwnScopedStorageUpload({
        authUid: 'uploader-1',
        pathUserId: 'uploader-1',
        hasCurrentScopeAccess: false
    }), false, 'Revoked uploader Storage delete case');
    assertEquals(canDeleteOwnScopedStorageUpload({
        authUid: 'outsider-1',
        pathUserId: 'uploader-1',
        hasCurrentScopeAccess: true
    }), false, 'Outsider Storage delete case');
    assertEquals(canDeleteOwnScopedStorageUpload({
        authUid: 'coach-1',
        pathUserId: 'uploader-1',
        isTeamAdmin: true
    }), true, 'Team admin Storage delete case');
    assertIncludes(storageRules, 'match /game-clips/{fileName} {', 'Legacy Storage game clip rules');
    assertIncludes(legacyGameClipRules, 'allow get, create, delete: if false;', 'Legacy Storage deny-all rule');
    assertIncludes(storageRules, 'function isAllowedChatAttachmentUpload(contentType, size)', 'Chat fallback attachment upload helper');
    assertIncludes(storageRules, 'size <= 5 * 1024 * 1024', 'Chat fallback attachment size limit');
    assertIncludes(storageRules, 'contentType.matches(\'image/.*\')', 'Chat fallback image content-type rules');
    assertIncludes(storageRules, 'contentType.matches(\'video/.*\')', 'Chat fallback video content-type rules');
    assertIncludes(chatFallbackRules, 'isAllowedChatAttachmentUpload(request.resource.contentType, request.resource.size);', 'Chat fallback create upload guard');
    assertIncludes(storageRules, 'function athleteProfileMatchesPathOwner(userId, profileId)', 'Athlete profile media owner helper');
    assertIncludes(storageRules, 'firestore.get(profilePath).data.parentUserId == userId;', 'Athlete profile media path owner match');
    assertIncludes(storageRules, 'return athleteProfileMatchesPathOwner(userId, profileId) &&', 'Athlete profile media public read path owner guard');
    assertIncludes(athleteProfileMediaRules, 'allow get: if canReadAthleteProfileMedia(userId, profileId);', 'Athlete profile media read guard');
    assertIncludes(athleteProfileMediaRules, 'request.auth.uid == userId &&\n        athleteProfileMatchesPathOwner(userId, profileId) &&', 'Athlete profile media create owner guard');
    assertIncludes(athleteProfileMediaRules, 'allow delete: if isVerifiedForSensitiveWrite() &&\n        request.auth.uid == userId &&\n        athleteProfileMatchesPathOwner(userId, profileId);', 'Athlete profile media delete owner guard');

    assertIncludes(regressionGuards, 'npm run ci:firebase-rules', 'Regression guard workflow');
    assertIncludes(regressionGuards, 'npm run test:smoke:team-fallback', 'Regression guard workflow');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    validateFirebaseRulesCi();
}
