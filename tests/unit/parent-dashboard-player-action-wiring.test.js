import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readParentDashboardSource() {
    return readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
}

describe('parent dashboard player action wiring', () => {
    it('serializes My Players action onclick arguments as JavaScript strings before HTML escaping', () => {
        const html = readParentDashboardSource();

        expect(html).toContain('function escapeJsArgAttr(value)');
        expect(html).toContain("return escapeAttr(JSON.stringify(String(value ?? '')));");
        expect(html).toContain('openInviteCoParentModal(${escapeJsArgAttr(child.teamId)}, ${escapeJsArgAttr(child.playerId)}, ${escapeJsArgAttr(child.playerName)})');
        expect(html).toContain('openIncentivesPanel(${escapeJsArgAttr(child.playerId)}, ${escapeJsArgAttr(child.playerName)}, ${escapeJsArgAttr(child.teamId)})');
        expect(html).not.toContain("openInviteCoParentModal('${escapeAttr(child.teamId)}', '${escapeAttr(child.playerId)}', '${escapeAttr(child.playerName)}')");
        expect(html).not.toContain("openIncentivesPanel('${escapeAttr(child.playerId)}', '${escapeAttr(child.playerName)}', '${escapeAttr(child.teamId)}')");
    });

    it('serializes schedule earnings incentive action arguments the same way', () => {
        const html = readParentDashboardSource();

        expect(html).toContain("openIncentivesPanel(${escapeJsArgAttr(game.childId)}, ${escapeJsArgAttr(game.childName || '')}, ${escapeJsArgAttr(game.teamId)})");
        expect(html).not.toContain("openIncentivesPanel('${escapeAttr(game.childId)}', '${escapeAttr(game.childName || '')}', '${escapeAttr(game.teamId)}')");
    });
});
