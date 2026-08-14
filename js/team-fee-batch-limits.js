export const MAX_TEAM_FEE_BATCH_RECIPIENTS = 499;
export const TEAM_FEE_BATCH_RECIPIENT_LIMIT_ERROR = 'A fee batch can include at most 499 recipients. Split the roster into smaller fee batches and try again.';

export function normalizeTeamFeeRecipientId(value) {
    return String(value ?? '').trim();
}

export function normalizeTeamFeeRecipientIds(recipientIds = []) {
    const seen = new Set();
    return (recipientIds || []).reduce((normalizedIds, recipientId) => {
        const normalizedId = normalizeTeamFeeRecipientId(recipientId);
        if (!normalizedId || seen.has(normalizedId)) return normalizedIds;
        seen.add(normalizedId);
        normalizedIds.push(normalizedId);
        return normalizedIds;
    }, []);
}

export function normalizeTeamFeeRecipientRecords(recipients = []) {
    const seen = new Set();
    return (recipients || []).reduce((normalizedRecipients, recipient) => {
        const playerId = normalizeTeamFeeRecipientId(recipient?.playerId);
        if (!playerId || seen.has(playerId)) return normalizedRecipients;
        seen.add(playerId);
        normalizedRecipients.push({ ...recipient, playerId });
        return normalizedRecipients;
    }, []);
}

export function assertTeamFeeRecipientLimit(recipientCount) {
    if (recipientCount > MAX_TEAM_FEE_BATCH_RECIPIENTS) {
        throw new Error(TEAM_FEE_BATCH_RECIPIENT_LIMIT_ERROR);
    }
}
