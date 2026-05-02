export function normalizeRolloverEmail(email) {
    return String(email || '').trim().toLowerCase();
}

export function buildRolloverAccessPreview(sourceTeam = {}, targetTeam = {}) {
    const sourceTeamId = sourceTeam.id || sourceTeam.teamId || null;
    const targetAdminEmails = new Set(
        (Array.isArray(targetTeam.adminEmails) ? targetTeam.adminEmails : [])
            .map(normalizeRolloverEmail)
            .filter(Boolean)
    );

    const seen = new Set();
    const staffAdmins = (Array.isArray(sourceTeam.adminEmails) ? sourceTeam.adminEmails : [])
        .map(normalizeRolloverEmail)
        .filter((email) => {
            if (!email || seen.has(email) || targetAdminEmails.has(email)) return false;
            seen.add(email);
            return true;
        })
        .map((email) => ({
            email,
            sourceTeamId
        }));

    return {
        sourceTeamId,
        staffAdmins,
        memberAccessSupported: false,
        memberAccessReason: 'Fan/member access is tied to player links in the current data model, so it is omitted until player rollover can map copied players.'
    };
}

export function buildStaffAdminRolloverUpdate({
    sourceTeam = {},
    targetTeam = {},
    selectedEmails = [],
    rolledOverAt = new Date()
} = {}) {
    const sourceTeamId = sourceTeam.id || sourceTeam.teamId || null;
    const existingEmails = (Array.isArray(targetTeam.adminEmails) ? targetTeam.adminEmails : [])
        .map(normalizeRolloverEmail)
        .filter(Boolean);
    const existingSet = new Set(existingEmails);
    const sourceEmails = new Set(
        (Array.isArray(sourceTeam.adminEmails) ? sourceTeam.adminEmails : [])
            .map(normalizeRolloverEmail)
            .filter(Boolean)
    );
    const selectedSet = new Set(
        selectedEmails
            .map(normalizeRolloverEmail)
            .filter(Boolean)
    );

    const copiedEmails = [];
    selectedSet.forEach((email) => {
        if (!sourceEmails.has(email) || existingSet.has(email)) return;
        existingSet.add(email);
        copiedEmails.push(email);
    });

    const previousAudit = Array.isArray(targetTeam.accessRolloverAudit?.staffAdmins)
        ? targetTeam.accessRolloverAudit.staffAdmins
        : [];
    const staffAdminsAudit = [
        ...previousAudit,
        ...copiedEmails.map((email) => ({
            email,
            sourceTeamId,
            rolledOverAt
        }))
    ];

    return {
        adminEmails: [...existingEmails, ...copiedEmails],
        copiedEmails,
        accessRolloverAudit: {
            ...(targetTeam.accessRolloverAudit || {}),
            staffAdmins: staffAdminsAudit
        }
    };
}
