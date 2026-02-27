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
            const code = inviteResult?.code || null;

            if (inviteResult?.existingUser) {
                summary.existingUserCount += 1;
                summary.results.push({ email, status: 'existing_user', code });
                continue;
            }

            try {
                await sendInviteEmail(email, code, 'admin', { teamName: inviteResult?.teamName || null });
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
