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
        expect(html).toContain('(!canLinkReplayVideo && !canRemoveReplayVideoOutsideFinal)');
        expect(html).toContain("managementState = await gameReplayService.readManagement({ teamId, gameId });");
        expect(html).toContain('setupReplayVideoControls({ teamId, gameId, game, team: resolvedTeam });');
    });

    it('normalizes and manages replay state only through the private callable service', () => {
        const html = readGameReport();

        expect(html).toContain("import { gameReplayService, getRecordedReplayRevision, hasRecordedReplayMarker } from './js/game-replay-service.js?v=2';");
        expect(html).toContain('if (!normalizeYouTubeReplayUrl(rawUrl))');
        expect(html).toContain('managementState = await gameReplayService.setReplay({');
        expect(html).toContain('expectedRevision: managementState?.replayArchiveRevision || getRecordedReplayRevision(game)');
        expect(html).toContain('youtubeUrl: rawUrl');
        expect(html).toContain('managementState = await gameReplayService.removeReplay({');
        expect(html).toContain("saveButton.textContent = 'Replace replay';");
        expect(html).toContain("removeButton.classList.toggle('hidden', !canRemoveCurrentReplay());");
        expect(html).toContain("const linkedReplay = managementState?.state === 'ready'");
        expect(html).toContain("window.confirm('Remove the replay from this game? The source video will remain with its provider.')");
        expect(html).not.toContain('runTransaction(db');
        expect(html).not.toContain('transaction.update(gameRef');
        expect(html).not.toContain('game.replayVideo =');
    });

    it('requires an authoritative initial read and never reports an uncertain write as success', () => {
        const html = readGameReport();

        expect(html).toContain('managementStateComplete = false;');
        expect(html).toContain('Replay controls are unavailable until the current state can be verified. Refresh this report to retry.');
        expect(html).toContain('setBusy(!managementStateComplete);');
        expect(html).toContain("['functions/aborted', 'aborted', 'functions/failed-precondition', 'failed-precondition']");
        expect(html).toContain('The linked replay changed since this report loaded. Refresh and review the current replay before trying again.');
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

        expect(html).toContain('hasRecordedReplayMarker(game) || hasCompletedTimelineReplay');
        expect(html).toContain('const hasCompletedTimelineReplay');
    });
});
