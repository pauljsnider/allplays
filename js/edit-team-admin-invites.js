export async function processPendingAdminInvites({
    teamId,
    pendingEmails,
    inviteAdmin,
    sendInviteEmail
}) {
    const summary = {
        sentCount: 0,
        existingUserCount: 0,
        fallbackCodeCount: 0,
        failedCount: 0,
        results: []
    };

    const normalized = Array.isArray(pendingEmails)
        ? pendingEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
        : [];
    const uniqueEmails = [...new Set(normalized)];

    if (!teamId || uniqueEmails.length === 0) {
        return summary;
    }

    for (const email of uniqueEmails) {
        try {
            const inviteResult = await inviteAdmin(teamId, email);
            const parsedInviteResult = (inviteResult && typeof inviteResult === 'object')
                ? inviteResult
                : null;
            const code = typeof parsedInviteResult?.code === 'string'
                ? parsedInviteResult.code.trim()
                : '';

            if (parsedInviteResult?.existingUser) {
                summary.existingUserCount += 1;
                summary.results.push({ email, status: 'existing_user', code: code || null });
                continue;
            }

            if (!code) {
                summary.fallbackCodeCount += 1;
                summary.results.push({
                    email,
                    status: 'fallback_code',
                    code: null,
                    reason: 'missing_invite_code'
                });
                continue;
            }

            try {
                await sendInviteEmail(email, code, 'admin', { teamName: parsedInviteResult?.teamName || null });
                summary.sentCount += 1;
                summary.results.push({ email, status: 'sent', code });
            } catch (_emailError) {
                summary.fallbackCodeCount += 1;
                summary.results.push({ email, status: 'fallback_code', code });
            }
        } catch (error) {
            summary.failedCount += 1;
            summary.results.push({
                email,
                status: 'failed',
                error: error?.message || 'Failed to process invite'
            });
        }
    }

    return summary;
}

export function buildAdminInviteFollowUp(summary, origin = '') {
    const fallbackSummary = summary && typeof summary === 'object' ? summary : {};
    const results = Array.isArray(fallbackSummary.results) ? fallbackSummary.results : [];
    const normalizedOrigin = String(origin || '').replace(/\/$/, '');

    const shareableInvites = [];
    let unresolvedCount = 0;

    for (const result of results) {
        const status = typeof result?.status === 'string' ? result.status : '';
        const code = typeof result?.code === 'string' ? result.code.trim() : '';
        const email = typeof result?.email === 'string' ? result.email.trim().toLowerCase() : '';

        const canShareCode = (status === 'existing_user' || status === 'fallback_code') && Boolean(code);
        if (canShareCode) {
            const acceptInviteUrl = normalizedOrigin
                ? `${normalizedOrigin}/accept-invite.html?code=${encodeURIComponent(code)}`
                : `accept-invite.html?code=${encodeURIComponent(code)}`;
            shareableInvites.push({ email, code, acceptInviteUrl });
            continue;
        }

        if (status === 'failed' || status === 'fallback_code' || status === 'existing_user') {
            unresolvedCount += 1;
        }
    }

    const shareableDetails = shareableInvites
        .map((item) => `${item.email} | code: ${item.code} | ${item.acceptInviteUrl}`)
        .join('\n');

    return {
        shareableInvites,
        shareableCount: shareableInvites.length,
        unresolvedCount,
        shareableDetails
    };
}
