import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGameReport() {
    return readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
}

describe('legacy game report YouTube replay management', () => {
    it('provides a compact, labelled form with live status feedback', () => {
        const html = readGameReport();

        expect(html).toContain('id="replay-video-admin"');
        expect(html).toContain('aria-labelledby="replay-video-heading"');
        expect(html).toContain('id="replay-video-form"');
        expect(html).toContain('for="replay-video-url"');
        expect(html).toContain('id="replay-video-url"');
        expect(html).toContain('maxlength="2048"');
        expect(html).toContain('for="replay-video-title"');
        expect(html).toContain('id="replay-video-title"');
        expect(html).toContain('maxlength="120"');
        expect(html).toContain('text-base md:text-sm');
        expect(html).toContain('min-h-11');
        expect(html).toMatch(/id="replay-video-heading"[^>]*tabindex="-1"/);
        expect(html).toMatch(/id="replay-video-status"[^>]*role="status"[^>]*aria-live="polite"/);
        expect(html).toContain('id="replay-video-save"');
        expect(html).toContain('id="replay-video-remove"');
    });

    it('shows controls only for completed games managed by full staff or scoped videographers', () => {
        const html = readGameReport();

        expect(html).toContain('getDelegatedTeamContext');
        expect(html).toContain('await getDelegatedTeamContext(teamId, gameId, { includeInactive: true })');
        expect(html).toContain('delegatedTeam.isDelegatedTeamContext === true');
        expect(html).toContain('delegatedTeam.delegatedAccess?.full === true');
        expect(html).toContain("{ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' }");
        expect(html).toContain('function hasSelectedVideographyGrant(team, user)');
        expect(html).toContain("permission?.mode === 'selected'");
        expect(html).toContain("accessInfo.accessLevel === 'videographer' && hasSelectedVideographyGrant(accessTeam, currentUser)");
        expect(html).toContain('const gameCompleted = isCompletedGameForReplay(game);');
        expect(html).toContain("const finalStatuses = new Set(['completed', 'final']);");
        expect(html).toContain("typeof value === 'string' ? value : '__invalid__'");
        expect(html).toContain("finalStatuses.has(liveStatus) || liveStatus === 'scheduled'");
        expect(html).toContain('(!status && finalStatuses.has(liveStatus))');
        expect(html).toContain('function isCanonicalReplayMutationTarget(game)');
        expect(html).toContain('const isCanonicalTeamGame = isCanonicalReplayMutationTarget(game);');
        expect(html).toContain('const canLinkReplayVideo = gameCompleted && canManageReplayVideo;');
        expect(html).toContain("canRemoveReplayVideoOutsideFinal = accessInfo.accessLevel === 'full';");
        expect(html).toContain("return value !== null && value !== undefined && value !== '';");
        expect(html).toContain('&& !hasReplayShareMarker(game?.sharedScheduleId)');
        expect(html).toContain('&& !hasReplayShareMarker(game?.sharedGameId)');
        expect(html).toContain('(!canLinkReplayVideo && !canRemoveCurrentReplay())');
        expect(html).toContain('setupReplayVideoControls({ teamId, gameId, game, team: resolvedTeam });');
    });

    it('normalizes and persists one canonical replayVideo field for link, replace, and removal', () => {
        const html = readGameReport();

        expect(html).toMatch(/import \{[^}]*buildYouTubeReplayVideo[^}]*fingerprintGameReplayArchiveState[^}]*hasGameReplayArchiveEvidence[^}]*normalizeYouTubeReplayUrl[^}]*\} from '\.\/js\/game-replay-video\.js\?v=\d+';/);
        expect(html).toContain('if (!normalizeYouTubeReplayUrl(rawUrl))');
        expect(html).toContain('normalizedCandidates.some((candidate) => !candidate)');
        expect(html).toContain('return videoIds.size === 1 ? normalizedCandidates[0] : null;');
        expect(html).toMatch(/buildYouTubeReplayVideo\(rawUrl, \{\s*title: replayTitle,\s*linkedBy: currentUser\.uid,\s*linkedAt: new Date\(\)\s*\}\)/);
        expect(html).toContain("window.confirm('Replace the existing non-YouTube replay with this YouTube video?')");
        expect(html).toContain('const saved = await persistReplayVideo(replayVideo);');
        expect(html).toContain('const removed = await persistReplayVideo(null);');
        expect(html).toContain("saveButton.textContent = 'Replace replay';");
        expect(html).toContain("removeButton.classList.toggle('hidden', !canRemoveCurrentReplay());");
        expect(html).toContain('const linkedReplay = game.replayVideoFallbackDisabled === true');
        expect(html).toContain("window.confirm('Remove the replay from this game? The source video will remain with its provider.')");
        expect(html).toContain('GAME_REPLAY_CLEAR_FIELDS.forEach((field) => {');
        expect(html).toContain('replayUpdate[field] = deleteField();');
        expect(html).toContain('replayUpdate.replayVideoFallbackDisabled = nextReplayVideo ? deleteField() : true;');
    });

    it('revalidates stale state and never reports an uncertain write as success', () => {
        const html = readGameReport();

        expect(html).toContain('await runTransaction(db, async (transaction) => {');
        expect(html).toContain("const gameRef = doc(db, 'teams', teamId, 'games', gameId);");
        expect(html).toContain('const snapshot = await transaction.get(gameRef);');
        expect(html).toContain('fingerprintGameReplayArchiveState(latestGame) !== expectedFingerprint');
        expect(html).toContain('applyGameReplayArchiveState(game, error.latestReplayArchiveState)');
        expect(html).toContain("...(Object.hasOwn(game, 'videoUrl') ? { videoUrl: game.videoUrl } : {})");
        expect(html).not.toContain("if (!Object.hasOwn(archiveState, 'videoUrl')");
        expect(html).toContain('if (nextReplayVideo && !isCompletedGameForReplay(latestGame))');
        expect(html).toContain('if (!isCanonicalReplayMutationTarget(latestGame))');
        expect(html).toContain("error.code = 'replay-game-shared';");
        expect(html).toContain('transaction.update(gameRef, replayUpdate);');
        expect(html).toContain('The linked replay changed since this report loaded. Review the current replay before trying again.');
        expect(html).toContain('Could not confirm whether the replay was saved. Refresh this report and check the linked replay before trying again.');
        expect(html).toContain('Could not confirm whether the replay was removed. Refresh this report and check the linked replay before trying again.');
        expect(html).toContain('updateReplayReportAction({ teamId, gameId, game, team });');
        expect(html).toContain("renderCurrentReplay({ keepSectionVisible: !canLinkReplayVideo });");
        expect(html).toContain('if (!canLinkReplayVideo) heading.focus();');
    });

    it('uses the ordered replay lifecycle before rendering highlight links', () => {
        const html = readGameReport();

        expect(html).toContain('const gameCompleted = getGameReplayLifecycle(game).isCompleted;');
    });

    it('does not promote an attached highlight clip to a full-game replay action', () => {
        const html = readGameReport();

        expect(html).toContain('replayOptions.hasVideo && replayOptions.isRecordedReplay === true');
        expect(html).toContain('const hasCompletedTimelineReplay');
    });
});
