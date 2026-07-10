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

    it('blocks selected-member sends until a recipient is selected', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('function isMissingSelectedChatRecipients()');
        expect(html).toContain("selectedRecipientTarget === 'individuals' &&\n                selectedRecipientIds.size === 0");
        expect(html).toContain('function validateChatAudienceSelection()');
        expect(html).toContain("showError('Select at least one recipient before sending.');");
        expect(html).toContain("return 'Audience: Select at least one member';");
        expect(html).not.toContain('Audience: Full team (no selected members yet)');

        const triggerSend = html.slice(
            html.indexOf('function triggerSend()'),
            html.indexOf('async function sendMessage()')
        );
        expect(triggerSend.indexOf('if (!validateChatAudienceSelection()) return;'))
            .toBeLessThan(triggerSend.indexOf('aiUiPending = true;'));

        const sendMessage = html.slice(
            html.indexOf('async function sendMessage()'),
            html.indexOf('window.removeSelectedMedia = function')
        );
        expect(sendMessage).toContain('if (!validateChatAudienceSelection()) return;');
    });

    it('keeps follow-up messages in staff-only conversations targeted to staff', () => {
        const html = readRepoFile('team-chat.html');
        const buildTargetMetadata = html.slice(
            html.indexOf('function buildRecipientTargetMetadata()'),
            html.indexOf('function getConversationEmailRecipientIds')
        );

        expect(buildTargetMetadata).toContain('activeConversation.participantRoles');
        expect(buildTargetMetadata).toContain("participantRoles.includes('staff')");
        expect(buildTargetMetadata).toContain("targetType: 'staff'");
        expect(buildTargetMetadata).toContain('recipientIds: []');
        expect(buildTargetMetadata).toContain("targetRole: 'staff'");
        expect(buildTargetMetadata.indexOf("participantRoles.includes('staff')"))
            .toBeLessThan(buildTargetMetadata.indexOf("targetType: activeConversation.type === 'direct' ? 'individuals' : 'individuals'"));
    });

    it('persists normalized target metadata from postChatMessage', () => {
        const db = readRepoFile('js/db.js');

        expect(db).toContain("targetType = 'full_team'");
        expect(db).toContain('recipientIds = []');
        expect(db).toContain('targetRole = null');
        expect(db).toContain("const allowedTargetTypes = new Set(['full_team', 'staff', 'individuals']);");
        expect(db).toContain("if (normalizedTargetType === 'individuals' && normalizedRecipientIds.length === 0)");
        expect(db).toContain("throw new Error('Selected-member chat messages require at least one recipient.');");
        expect(db).toContain('const effectiveTargetType = normalizedTargetType;');
        expect(db).toContain('targetType: effectiveTargetType');
        expect(db).toContain('recipientIds: normalizedRecipientIds');
        expect(db).toContain("targetRole: effectiveTargetType === 'staff' ? (targetRole || 'staff') : null");
    });
});
