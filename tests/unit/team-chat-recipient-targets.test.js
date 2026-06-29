import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team chat recipient targets', () => {
    it('exposes recipient options and audience summary in the composer', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('id="recipient-picker"');
        expect(html).toContain('id="recipient-target"');
        expect(html).toContain('<option value="full_team">Full team</option>');
        expect(html).toContain('<option value="staff">Staff only</option>');
        expect(html).toContain('<option value="individuals">Selected members</option>');
        expect(html).toContain('id="recipient-summary"');
    });

    it('loads roster/community recipient options and sends target metadata', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('await loadRecipientOptions();');
        expect(html).toContain('const players = await getPlayers(teamId);');
        expect(html).toContain('function getPlayerGuardianRecipientIds(player = {})');
        expect(html).toContain('const guardianRecipientIds = getPlayerGuardianRecipientIds(player);');
        expect(html).toContain('recipientIds: guardianRecipientIds');
        expect(html).toContain('...(Array.isArray(player.contacts) ? player.contacts : [])');
        expect(html).toContain('...(Array.isArray(player.guardians) ? player.guardians : [])');
        expect(html).toContain('const contactKey = contact?.userId || contact?.email ||');
        expect(html).toContain('return Array.isArray(option?.recipientIds) && option.recipientIds.length > 0');
        expect(html).toContain('Array.isArray(player.parents)');
        expect(html).toContain('...buildRecipientTargetMetadata()');
        expect(html).toContain("targetType: 'staff'");
        expect(html).toContain("targetType: 'full_team'");
        expect(html).toContain('const recipientIds = Array.from(new Set(Array.from(selectedRecipientIds).flatMap((id) => {');
        expect(html).toContain('function buildEmailTargetMetadata()');
        expect(html).toContain("participantRoles.includes('staff')");
        expect(html).toContain('const targetMetadata = buildEmailTargetMetadata();');
        expect(html).toContain("const participantIds = targetMetadata.targetType === 'staff'\n                        ? []");
        expect(html).toContain('function getTargetedConversationName(targetMetadata = {})');
        expect(html).toContain('const selectedOptionsById = new Map(recipientOptions.map((option) => [option.id, option]));');
        expect(html).toContain('name: getTargetedConversationName(targetMetadata)');
        expect(html).not.toContain("name: targetMetadata.targetType === 'staff' ? 'Staff only' : null");
    });

    it('persists normalized target metadata from postChatMessage', () => {
        const db = readRepoFile('js/db.js');

        expect(db).toContain("targetType = 'full_team'");
        expect(db).toContain('recipientIds = []');
        expect(db).toContain('targetRole = null');
        expect(db).toContain("const allowedTargetTypes = new Set(['full_team', 'staff', 'individuals']);");
        expect(db).toContain("const effectiveTargetType = normalizedTargetType === 'individuals' && normalizedRecipientIds.length === 0");
        expect(db).toContain('targetType: effectiveTargetType');
        expect(db).toContain('recipientIds: normalizedRecipientIds');
        expect(db).toContain("targetRole: effectiveTargetType === 'staff' ? (targetRole || 'staff') : null");
    });
});
