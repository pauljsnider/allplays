function emailLocalPart(email) {
    return String(email || '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || '';
}

function getProfileName(profile, fallback = '') {
    return String(
        profile?.fullName ||
        profile?.displayName ||
        profile?.name ||
        profile?.email ||
        fallback ||
        ''
    ).trim();
}

function normalizeSigner(signer = {}, index = 0) {
    return {
        userId: signer.userId || null,
        email: signer.email || null,
        name: String(signer.name || '').trim() || (index === 0 ? 'Head Coach' : 'Assistant Coach'),
        role: String(signer.role || '').trim() || (index === 0 ? 'Head Coach' : 'Assistant Coach'),
        signatureStyle: ['script', 'typed', 'image'].includes(signer.signatureStyle) ? signer.signatureStyle : 'script',
        signatureImageUrl: signer.signatureImageUrl || null
    };
}

export function normalizeSigners(signers = []) {
    return (Array.isArray(signers) ? signers : [])
        .slice(0, 4)
        .map((signer, index) => normalizeSigner(signer, index));
}

export async function buildDefaultSigners(team = {}, currentUser = {}, deps = {}) {
    const signers = [];
    const seen = new Set();
    const addSigner = (signer) => {
        const key = signer.userId || String(signer.email || signer.name || '').toLowerCase();
        if (!key || seen.has(key) || signers.length >= 4) return;
        seen.add(key);
        signers.push(normalizeSigner(signer, signers.length));
    };

    if (team.ownerId) {
        let ownerProfile = null;
        try {
            ownerProfile = deps.getUserProfile ? await deps.getUserProfile(team.ownerId) : null;
        } catch (error) {
            console.warn('[certificates] Failed to load owner profile for signer defaults:', error);
        }

        addSigner({
            userId: team.ownerId,
            email: ownerProfile?.email || team.ownerEmail || (currentUser.uid === team.ownerId ? currentUser.email : null),
            name: getProfileName(ownerProfile, team.ownerName || (currentUser.uid === team.ownerId ? currentUser.displayName || currentUser.email : '')),
            role: 'Head Coach',
            signatureStyle: 'script'
        });
    }

    const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
    for (const email of adminEmails) {
        if (signers.length >= 4) break;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail) continue;
        let adminProfile = null;
        try {
            adminProfile = deps.getUserByEmail ? await deps.getUserByEmail(normalizedEmail) : null;
        } catch (error) {
            console.warn('[certificates] Failed to load admin profile for signer defaults:', error);
        }
        addSigner({
            userId: adminProfile?.id || null,
            email: normalizedEmail,
            name: getProfileName(adminProfile, emailLocalPart(normalizedEmail)),
            role: signers.length === 0 ? 'Head Coach' : 'Assistant Coach',
            signatureStyle: 'script'
        });
    }

    if (signers.length === 0 && currentUser?.email) {
        addSigner({
            userId: currentUser.uid || null,
            email: currentUser.email,
            name: currentUser.displayName || emailLocalPart(currentUser.email),
            role: 'Head Coach',
            signatureStyle: 'script'
        });
    }

    return normalizeSigners(signers);
}
