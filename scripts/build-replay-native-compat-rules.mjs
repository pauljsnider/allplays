import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const serverOnlyGeneratedProfileMediaBlock = `      allow create: if isVerifiedForSensitiveWrite() &&
                       request.resource.data.parentUserId == request.auth.uid &&
                       !request.resource.data.keys().hasAny(athleteProfileMediaFields());
      allow update: if isVerifiedForSensitiveWrite() &&
                       resource.data.parentUserId == request.auth.uid &&
                       request.resource.data.parentUserId == resource.data.parentUserId &&
                       !request.resource.data.diff(resource.data).affectedKeys()
                         .hasAny(athleteProfileMediaFields());`;

const compatibilityGeneratedProfileMediaBlock = `      // Transitional installed-native compatibility only. Updated callers use
      // saveAthleteProfileProjection, while legacy callers may still replace the
      // intentional clips and generated gameClips/seasons projection. Server reconciliation markers
      // remain immutable from clients in both rollout modes.
      allow create: if isVerifiedForSensitiveWrite() &&
                       request.resource.data.parentUserId == request.auth.uid &&
                       !request.resource.data.keys().hasAny([
                         'profileProjectionSchemaVersion',
                         'profileProjectionMutationId',
                         'profileProjectionMutationHash'
                       ]);
      allow update: if isVerifiedForSensitiveWrite() &&
                       resource.data.parentUserId == request.auth.uid &&
                       request.resource.data.parentUserId == resource.data.parentUserId &&
                       !request.resource.data.diff(resource.data).affectedKeys().hasAny([
                         'profileProjectionSchemaVersion',
                         'profileProjectionMutationId',
                         'profileProjectionMutationHash'
                       ]);`;

const serverOnlyTeamStructuredMediaBoundary = `      allow create: if isVerifiedForSensitiveWrite() &&
                       request.resource.data.ownerId == request.auth.uid &&
                       !request.resource.data.keys().hasAny(teamReplayArchiveFields()) &&
                       hasNoClientCalendarCredentialFields(request.resource.data);
      allow update: if isVerifiedForSensitiveWrite() &&
                       !request.resource.data.diff(resource.data).affectedKeys()
                         .hasAny(teamReplayArchiveFields()) &&
                       ((isTeamOwnerOrGlobalAdmin(teamId) && keepsOwnerControlledTeamPrivilegeFieldsImmutable()) ||
                        (isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable()));`;

const compatibilityTeamStructuredMediaBoundary = `      // Transitional installed-native compatibility only. Updated callers use
      // mutateStructuredMediaIdentity for fixed team video fields.
      allow create: if isVerifiedForSensitiveWrite() &&
                       request.resource.data.ownerId == request.auth.uid &&
                       hasNoClientCalendarCredentialFields(request.resource.data);
      allow update: if isVerifiedForSensitiveWrite() &&
                       ((isTeamOwnerOrGlobalAdmin(teamId) && keepsOwnerControlledTeamPrivilegeFieldsImmutable()) ||
                        (isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable()));`;

const serverOnlyTeamMediaVideoLinkBoundary = `        allow create: if !request.resource.data.keys().hasAny(teamMediaVideoUrlFields()) &&
                         (canManageTeamMedia(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data));
        allow update: if !request.resource.data.diff(resource.data).affectedKeys()
                           .hasAny(teamMediaVideoUrlFields().concat(['type', 'mediaType'])) &&
                         (canManageTeamMedia(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId));`;

const compatibilityTeamMediaVideoLinkBoundary = `        // Transitional installed-native compatibility only. Updated callers use
        // mutateStructuredMediaIdentity for typed video-link creation/removal.
        allow create: if canManageTeamMedia(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);
        allow update: if canManageTeamMedia(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);`;

const serverOnlyDrillStructuredMediaCreateBoundary = `                      hasValidDrillExternalUrls(request.resource.data) &&
                      !request.resource.data.keys().hasAny(drillVideoUrlFields()) &&`;

const compatibilityDrillStructuredMediaCreateBoundary = `                      hasValidDrillExternalUrls(request.resource.data) &&`;

const serverOnlyDrillStructuredMediaUpdateBoundary = `                      hasSafeDrillExternalUrlUpdate() &&
                      !request.resource.data.diff(resource.data).affectedKeys()
                        .hasAny(drillVideoUrlFields()) &&`;

const compatibilityDrillStructuredMediaUpdateBoundary = `                      hasSafeDrillExternalUrlUpdate() &&`;

const finalDrillResourceCreateValidation = `      return isNullableDrillExternalUrl(data.get('youtubeUrl', null)) &&
             (attribution == null ||`;

const compatibilityDrillResourceCreateValidation = `      return isNullableDrillExternalUrl(data.get('youtubeUrl', null)) &&
             isNullableDrillExternalUrl(data.get('resourceUrl', null)) &&
             (attribution == null ||`;

const finalDrillResourceUpdateValidation = `      return (!affectedKeys.hasAny(['youtubeUrl']) ||
              isNullableDrillExternalUrl(request.resource.data.get('youtubeUrl', null))) &&
             (!affectedKeys.hasAny(['attribution']) ||`;

const compatibilityDrillResourceUpdateValidation = `      return (!affectedKeys.hasAny(['youtubeUrl']) ||
              isNullableDrillExternalUrl(request.resource.data.get('youtubeUrl', null))) &&
             (!affectedKeys.hasAny(['resourceUrl']) ||
              isNullableDrillExternalUrl(request.resource.data.get('resourceUrl', null))) &&
             (!affectedKeys.hasAny(['attribution']) ||`;

const serverOnlyGameCreateBoundary = `                         !request.resource.data.keys().hasAny(replayArchiveFields()) &&
                         !request.resource.data.keys().hasAny(replayClipFields()) &&
                         hasNoReadableBroadcastReplayCapability(request.resource.data) &&
                         request.resource.data.get('videoUrl', null) in [null, ''];`;

const compatibilityGameCreateBoundary = `                         !request.resource.data.keys().hasAny(replayArchiveFields()) &&
                         hasNoReadableBroadcastReplayCapability(request.resource.data) &&
                         request.resource.data.get('videoUrl', null) in [null, ''];`;

const serverOnlyGameDeleteBoundary = `        allow delete: if isReplayBoundarySafeDelete() &&
                         isTeamOwnerOrAdmin(teamId);`;

const compatibilityGameDeleteBoundary = `        // Transitional installed-native compatibility: legacy managers may
        // still delete a replay-bearing parent before the migration is started.
        allow delete: if isTeamOwnerOrAdmin(teamId);`;

const gameUpdateBoundaryAnchor = `        // Keep streaming branches separate for the expression budget.
        allow update: if preservesReadyReplayLifecycle() &&`;

const compatibilityGameMutationRules = `        // Transitional installed-native compatibility only. These two narrow
        // alternatives restore the legacy replay and generated-highlight paths
        // without bypassing final live-video or broadcast-provider validation.
        allow update: if isReplayArchiveOnlyUpdate() &&
                        ((isTeamOwnerOrAdmin(teamId) &&
                          isGameReplayVideoMutationValid(true)) ||
                         (canVideographGame(teamId, gameId) &&
                          isGameReplayVideoMutationValid(false)));
        allow update: if request.resource.data.diff(resource.data).affectedKeys().hasAny(replayClipFields()) &&
                        request.resource.data.diff(resource.data).affectedKeys().hasOnly([
                          'highlightClips', 'clipRecords', 'gameClips', 'videoClips',
                          'clips', 'mediaClips', 'clipMetadata', 'replayHighlights',
                          'highlightClipsRevision', 'highlightClipsLastMutationId',
                          'updatedAt'
                        ]) &&
                        (isTeamOwnerOrAdmin(teamId) || canVideographGame(teamId, gameId));

${gameUpdateBoundaryAnchor}`;

function replaceExactlyOnce(source, expected, replacement, label) {
    const firstMatch = source.indexOf(expected);
    if (firstMatch === -1 || source.indexOf(expected, firstMatch + 1) !== -1) {
        throw new Error(`Expected exactly one ${label}.`);
    }
    return source.replace(expected, replacement);
}

export function buildReplayNativeCompatibilityRules(finalRules) {
    let compatibility = replaceExactlyOnce(
        finalRules,
        serverOnlyGeneratedProfileMediaBlock,
        compatibilityGeneratedProfileMediaBlock,
        'server-only athlete profile generated-media rules block'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyTeamStructuredMediaBoundary,
        compatibilityTeamStructuredMediaBoundary,
        'server-only team structured-media rules block'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyTeamMediaVideoLinkBoundary,
        compatibilityTeamMediaVideoLinkBoundary,
        'server-only team media video-link rules block'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyDrillStructuredMediaCreateBoundary,
        compatibilityDrillStructuredMediaCreateBoundary,
        'server-only drill structured-media create boundary'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyDrillStructuredMediaUpdateBoundary,
        compatibilityDrillStructuredMediaUpdateBoundary,
        'server-only drill structured-media update boundary'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        finalDrillResourceCreateValidation,
        compatibilityDrillResourceCreateValidation,
        'compatibility drill resource create validation'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        finalDrillResourceUpdateValidation,
        compatibilityDrillResourceUpdateValidation,
        'compatibility drill resource update validation'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyGameCreateBoundary,
        compatibilityGameCreateBoundary,
        'server-only game replay/clip create boundary'
    );
    compatibility = replaceExactlyOnce(
        compatibility,
        serverOnlyGameDeleteBoundary,
        compatibilityGameDeleteBoundary,
        'server-only replay-bearing game delete boundary'
    );
    return replaceExactlyOnce(
        compatibility,
        gameUpdateBoundaryAnchor,
        compatibilityGameMutationRules,
        'game update boundary anchor'
    );
}

async function main() {
    const [, , inputPath, outputPath] = process.argv;
    if (!inputPath || !outputPath) {
        throw new Error('Usage: build-replay-native-compat-rules.mjs <input> <output>');
    }
    const finalRules = await readFile(inputPath, 'utf8');
    const compatibilityRules = buildReplayNativeCompatibilityRules(finalRules);
    await writeFile(outputPath, compatibilityRules, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
