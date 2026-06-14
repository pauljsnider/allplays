import { readAccountPremiumEntitlement } from './premium-entitlements.js?v=1';

export const MAX_FAMILY_PLAN_SLOTS = 4;

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
    const status = normalizeString(value).toLowerCase();
    return ['pending', 'active', 'removed'].includes(status) ? status : 'pending';
}

function generateHouseholdInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i += 1) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function normalizePlayerLinks(playerLinks = []) {
    return playerLinks
        .filter((link) => link?.teamId && link?.playerId)
        .map((link) => ({
            teamId: normalizeString(link.teamId),
            playerId: normalizeString(link.playerId),
            teamName: normalizeString(link.teamName),
            playerName: normalizeString(link.playerName || link.name),
            playerNumber: normalizeString(link.playerNumber || link.number),
            playerPhotoUrl: normalizeString(link.playerPhotoUrl || link.photoUrl),
        }));
}

function loadFirebase(deps = {}) {
    if (deps.firebase) return Promise.resolve(deps.firebase);
    return import('./firebase.js?v=18');
}

function normalizeAccessLinks(links = []) {
    const normalized = Array.isArray(links) ? links : [links];
    return normalized
        .filter((link) => link && typeof link === 'object')
        .map((link) => ({
            teamId: normalizeString(link.teamId),
            playerId: normalizeString(link.playerId),
            teamName: normalizeString(link.teamName),
            playerName: normalizeString(link.playerName),
            playerNumber: normalizeString(link.playerNumber),
            relation: normalizeString(link.relation)
        }))
        .filter((link) => link.teamId && link.playerId);
}

function dataFromSnapshot(docSnap) {
    return typeof docSnap?.data === 'function' ? docSnap.data() : {};
}

export function normalizeFamilyMembers(records = []) {
    return records
        .filter((record) => record && typeof record === 'object')
        .map((record, index) => ({
            id: normalizeString(record.id) || `family-member-${index}`,
            email: normalizeString(record.email || record.invitedEmail || record.accountEmail),
            displayName: normalizeString(record.displayName || record.name || record.memberName),
            userId: normalizeString(record.userId || record.accountUserId || record.uid),
            status: normalizeStatus(record.status),
            teamName: normalizeString(record.teamName),
            playerName: normalizeString(record.playerName),
            playerNumber: normalizeString(record.playerNumber),
            accessCode: normalizeString(record.accessCode),
            inviteUrl: normalizeString(record.inviteUrl),
            invitedAt: record.invitedAt || record.createdAt || null,
            updatedAt: record.updatedAt || null,
            removedAt: record.removedAt || null,
            relation: normalizeString(record.relation),
            organizerUserId: normalizeString(record.organizerUserId || record.invitedByUserId),
            organizerName: normalizeString(record.organizerName || record.invitedByName),
            organizerEmail: normalizeString(record.organizerEmail || record.invitedByEmail),
            accessCodeId: normalizeString(record.accessCodeId || record.inviteCodeId),
            inviteCode: normalizeString(record.inviteCode || record.code),
            playerAccess: normalizeAccessLinks(record.playerAccess || record.playerLinks || record.accessLinks || record.players || (record.player ? [record.player] : [])),
        }))
        .sort((a, b) => {
            const statusOrder = { active: 0, pending: 1, removed: 2 };
            return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) || (a.displayName || a.email).localeCompare(b.displayName || b.email);
        });
}

export function getFamilySlotCounts(members = []) {
    const normalized = normalizeFamilyMembers(members);
    const used = normalized.filter((member) => member.status === 'active' || member.status === 'pending').length;
    return {
        used,
        remaining: Math.max(0, MAX_FAMILY_PLAN_SLOTS - used),
        max: MAX_FAMILY_PLAN_SLOTS,
    };
}

export function canAddFamilyMember(members = []) {
    return getFamilySlotCounts(members).used < MAX_FAMILY_PLAN_SLOTS;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function statusClasses(status) {
    if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'removed') return 'border-gray-200 bg-gray-50 text-gray-500';
    return 'border-amber-200 bg-amber-50 text-amber-700';
}

export function buildFamilyPlanMarkup({ members = [], entitlementState = 'locked', validationMessage = '', playerLinks = [] } = {}) {
    const normalized = normalizeFamilyMembers(members);
    const normalizedPlayerLinks = normalizePlayerLinks(playerLinks);
    const counts = getFamilySlotCounts(normalized);
    const slotsFull = counts.used >= counts.max;
    const entitlementActive = entitlementState === 'unlocked';
    const rows = normalized.length
        ? normalized.map((member) => {
            const label = member.displayName || member.email || 'Family member';
            const subline = member.displayName && member.email ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(member.email)}</div>` : '';
            const accessLine = member.status === 'pending' && (member.accessCode || member.inviteUrl)
                ? `<div class="text-xs text-gray-500 mt-1">Invite code: <span class="font-mono font-semibold text-gray-700">${escapeHtml(member.accessCode)}</span>${member.inviteUrl ? ` · <span class="font-mono">${escapeHtml(member.inviteUrl)}</span>` : ''}</div>`
                : '';
            const playerLine = member.playerName || member.teamName
                ? `<div class="text-xs text-gray-500 mt-0.5">Access: ${escapeHtml(`${member.playerName || 'Player'}${member.playerNumber ? ` #${member.playerNumber}` : ''}${member.teamName ? `, ${member.teamName}` : ''}`)}</div>`
                : '';
            const removeButton = member.status === 'removed'
                ? ''
                : `<button type="button" data-family-plan-remove="${escapeHtml(member.id)}" class="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>`;
            return `
                <div class="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
                    <div>
                        <div class="font-semibold text-gray-900">${escapeHtml(label)}</div>
                        ${subline}
                        ${playerLine}
                        ${accessLine}
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="px-2 py-1 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${statusClasses(member.status)}">${escapeHtml(member.status)}</span>
                        ${removeButton}
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">No family members or pending invites yet.</div>';

    return `
        <div class="p-6 border-b border-gray-100 bg-gray-50">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 class="text-xl font-bold text-gray-900">Family Plan</h2>
                    <p class="text-xs text-gray-500 mt-1">Manage up to ${MAX_FAMILY_PLAN_SLOTS} household accounts or pending invites.</p>
                </div>
                <span class="self-start px-3 py-1 rounded-full border text-xs font-semibold ${entitlementActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}">${entitlementActive ? 'Premium active' : 'Setup only'}</span>
            </div>
        </div>
        <div class="p-6 space-y-4">
            ${entitlementActive ? '' : '<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Billing and premium activation are not connected yet. These slots only capture the intended household members until an active account entitlement exists.</div>'}
            <div class="flex items-center justify-between gap-3 text-sm">
                <div class="font-semibold text-gray-900">Member slots</div>
                <div class="text-gray-600"><span class="font-bold text-gray-900">${counts.used}</span> / ${counts.max} used</div>
            </div>
            <div class="space-y-2">${rows}</div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                ${normalizedPlayerLinks.length ? `<select id="family-plan-player-link" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                    <option value="">Select player access to share</option>
                    ${normalizedPlayerLinks.map((link) => `<option value="${escapeHtml(`${link.teamId}::${link.playerId}`)}">${escapeHtml(`${link.playerName || 'Player'}${link.playerNumber ? ` #${link.playerNumber}` : ''}${link.teamName ? `, ${link.teamName}` : ''}`)}</option>`).join('')}
                </select>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input id="family-plan-member-name" type="text" placeholder="Name (optional)" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                    <input id="family-plan-member-email" type="email" placeholder="Email for pending invite" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                </div>
                <input id="family-plan-member-relation" type="text" placeholder="Relation (for example: guardian, step-parent)" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                <button id="family-plan-add-member-btn" class="w-full bg-primary-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed" ${slotsFull ? 'disabled' : ''}>Add pending member</button>
                <div id="family-plan-validation" class="${validationMessage || slotsFull ? '' : 'hidden'} text-xs rounded-lg px-3 py-2 ${validationMessage ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">${escapeHtml(validationMessage || `Family Plan is limited to ${MAX_FAMILY_PLAN_SLOTS} active accounts or pending invites.`)}</div>
            </div>
        </div>
    `;
}

export function normalizeHouseholdInvites(records = []) {
    return records
        .filter((record) => record && typeof record === 'object')
        .map((record, index) => ({
            id: normalizeString(record.id) || `household-invite-${index}`,
            contactName: normalizeString(record.contactName || record.displayName || record.name),
            email: normalizeString(record.email).toLowerCase(),
            relation: normalizeString(record.relation),
            status: normalizeStatus(record.status),
            organizerUserId: normalizeString(record.organizerUserId),
            playerId: normalizeString(record.playerId),
            playerName: normalizeString(record.playerName),
            teamId: normalizeString(record.teamId),
            teamName: normalizeString(record.teamName),
            playerKey: normalizeString(record.playerKey),
            teamAccessIntent: record.teamAccessIntent === true,
            invitedAt: record.invitedAt || record.createdAt || null,
            updatedAt: record.updatedAt || null,
        }))
        .sort((a, b) => (a.playerName || '').localeCompare(b.playerName || '') || (a.contactName || a.email).localeCompare(b.contactName || b.email));
}

function normalizeLinkedPlayers(players = []) {
    return normalizePlayerLinks(players).map((player) => ({
        ...player,
        playerName: player.playerName || 'Player',
    }));
}

export function buildHouseholdInviteMarkup({ invites = [], linkedPlayers = [], validationMessage = '' } = {}) {
    const normalizedInvites = normalizeHouseholdInvites(invites).filter((invite) => invite.status === 'pending');
    const normalizedPlayers = normalizeLinkedPlayers(linkedPlayers);
    const playerOptions = normalizedPlayers.length
        ? normalizedPlayers.map((player) => `<option value="${escapeHtml(player.teamId)}::${escapeHtml(player.playerId)}">${escapeHtml(player.playerName)}${player.teamName ? ` — ${escapeHtml(player.teamName)}` : ''}</option>`).join('')
        : '<option value="">No linked players available</option>';
    const pendingRows = normalizedInvites.length
        ? normalizedInvites.map((invite) => `
            <div class="rounded-xl border border-gray-200 bg-white p-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <div class="font-semibold text-gray-900">${escapeHtml(invite.contactName || invite.email || 'Household contact')}</div>
                        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(invite.email)}</div>
                        <div class="text-xs text-gray-600 mt-1">${escapeHtml(invite.relation || 'Relation not specified')} for ${escapeHtml(invite.playerName || 'selected player')}${invite.teamName ? ` · ${escapeHtml(invite.teamName)}` : ''}</div>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="px-2 py-1 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${statusClasses(invite.status)}">${escapeHtml(invite.status)}</span>
                        <button type="button" data-household-invite-revoke="${escapeHtml(invite.id)}" class="text-xs font-semibold text-red-600 hover:text-red-700">Revoke</button>
                    </div>
                </div>
                ${invite.teamAccessIntent ? '<div class="text-xs text-primary-700 mt-2">Team access requested when invite acceptance is supported.</div>' : ''}
            </div>
        `).join('')
        : '<div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">No pending household player-access invites yet.</div>';

    return `
        <div class="p-6 border-t border-gray-100 space-y-4">
            <div>
                <h3 class="text-lg font-bold text-gray-900">Household player access</h3>
                <p class="text-xs text-gray-500 mt-1">Create pending invites for contacts who should share access to a specific linked player. Access is not granted until invite acceptance is built.</p>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                <select id="household-invite-player" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${normalizedPlayers.length ? '' : 'disabled'}>
                    <option value="">Select linked player</option>
                    ${playerOptions}
                </select>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input id="household-invite-name" type="text" placeholder="Contact name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${normalizedPlayers.length ? '' : 'disabled'}>
                    <input id="household-invite-email" type="email" placeholder="Contact email" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${normalizedPlayers.length ? '' : 'disabled'}>
                </div>
                <input id="household-invite-relation" type="text" placeholder="Relation, e.g. grandparent, step-parent" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${normalizedPlayers.length ? '' : 'disabled'}>
                <label class="flex items-start gap-2 text-xs text-gray-600">
                    <input id="household-invite-team-access" type="checkbox" class="mt-0.5 rounded border-gray-300 text-primary-600" ${normalizedPlayers.length ? '' : 'disabled'}>
                    <span>Intend to share team access when household invite acceptance is supported</span>
                </label>
                <button id="household-invite-add-btn" class="w-full bg-primary-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed" ${normalizedPlayers.length ? '' : 'disabled'}>Create pending household invite</button>
                <div id="household-invite-validation" class="${validationMessage ? '' : 'hidden'} text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200">${escapeHtml(validationMessage)}</div>
            </div>
            <div class="space-y-2">
                <div class="text-sm font-semibold text-gray-900">Pending household invites</div>
                ${pendingRows}
            </div>
        </div>
    `;
}

export function buildFamilyPlanSectionMarkup(state = {}) {
    return `${buildFamilyPlanMarkup(state)}${buildHouseholdInviteMarkup(state)}`;
}

export async function readFamilyMembers(userId, { deps = {} } = {}) {
    if (!userId) return [];
    const { db, collection, getDocs } = await loadFirebase(deps);
    const snapshot = await getDocs(collection(db, `users/${userId}/familyMemberships`));
    return normalizeFamilyMembers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...dataFromSnapshot(docSnap) })));
}

export async function readHouseholdInvites(userId, { deps = {} } = {}) {
    if (!userId) return [];
    const { db, collection, getDocs } = await loadFirebase(deps);
    const snapshot = await getDocs(collection(db, `users/${userId}/householdInvites`));
    return normalizeHouseholdInvites(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...dataFromSnapshot(docSnap) })));
}

export async function addPendingHouseholdInvite(userId, invite, { deps = {}, linkedPlayers = [] } = {}) {
    if (!userId) throw new Error('Missing signed-in user.');
    const normalizedPlayers = normalizeLinkedPlayers(linkedPlayers);
    const selectedKey = normalizeString(invite?.playerKey || `${normalizeString(invite?.teamId)}::${normalizeString(invite?.playerId)}`);
    const selectedPlayer = normalizedPlayers.find((player) => `${player.teamId}::${player.playerId}` === selectedKey);
    if (!selectedPlayer) throw new Error('Select a player already linked to your parent account.');

    const contactName = normalizeString(invite?.contactName || invite?.displayName || invite?.name);
    const email = normalizeString(invite?.email).toLowerCase();
    const relation = normalizeString(invite?.relation);
    if (!contactName) throw new Error('Enter the household contact name.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email for the household contact.');
    if (!relation) throw new Error('Enter the household contact relation.');

    const { db, collection, addDoc, serverTimestamp } = await loadFirebase(deps);
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();
    await addDoc(collection(db, `users/${userId}/householdInvites`), {
        contactName,
        email,
        relation,
        teamAccessIntent: invite?.teamAccessIntent === true,
        status: 'pending',
        organizerUserId: userId,
        playerId: selectedPlayer.playerId,
        playerName: selectedPlayer.playerName,
        teamId: selectedPlayer.teamId,
        teamName: selectedPlayer.teamName,
        playerKey: `${selectedPlayer.teamId}::${selectedPlayer.playerId}`,
        invitedAt: timestamp,
        updatedAt: timestamp,
    });
}

export async function removePendingHouseholdInvite(userId, inviteId, { deps = {} } = {}) {
    if (!userId || !inviteId) throw new Error('Missing household invite to revoke.');
    const { db, doc, deleteDoc } = await loadFirebase(deps);
    await deleteDoc(doc(db, `users/${userId}/householdInvites/${inviteId}`));
}

export async function addPendingFamilyMember(userId, member, { deps = {}, existingMembers = [] } = {}) {
    if (!userId) throw new Error('Missing signed-in user.');
    if (!canAddFamilyMember(existingMembers)) {
        throw new Error(`Family Plan is limited to ${MAX_FAMILY_PLAN_SLOTS} active accounts or pending invites.`);
    }

    const email = normalizeString(member?.email).toLowerCase();
    const displayName = normalizeString(member?.displayName);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Enter a valid email for the pending family member.');
    }

    const normalizedExisting = normalizeFamilyMembers(existingMembers);
    const duplicate = normalizedExisting.some((existing) => existing.status !== 'removed' && existing.email.toLowerCase() === email);
    if (duplicate) throw new Error('That family member is already active or pending.');

    const playerId = normalizeString(member?.playerId);
    const teamId = normalizeString(member?.teamId);
    if (!teamId || !playerId) {
        throw new Error('Select the player access to share with this household contact.');
    }

    const { db, collection, addDoc, updateDoc, doc, serverTimestamp, Timestamp } = await loadFirebase(deps);
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();
    const membershipRef = await addDoc(collection(db, `users/${userId}/familyMemberships`), {
        email,
        displayName,
        status: 'pending',
        organizerUserId: userId,
        teamId,
        playerId,
        teamName: normalizeString(member?.teamName),
        playerName: normalizeString(member?.playerName),
        playerNumber: normalizeString(member?.playerNumber),
        playerPhotoUrl: normalizeString(member?.playerPhotoUrl),
        relation: normalizeString(member?.relation) || 'Household contact',
        invitedAt: timestamp,
        updatedAt: timestamp,
    });

    const code = generateHouseholdInviteCode();
    const expiresAt = Timestamp?.fromMillis
        ? Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const accessCodeRef = await addDoc(collection(db, 'accessCodes'), {
        code,
        type: 'household_invite',
        email,
        displayName,
        generatedBy: userId,
        organizerUserId: userId,
        familyMembershipId: membershipRef.id,
        teamId,
        playerId,
        teamName: normalizeString(member?.teamName),
        playerName: normalizeString(member?.playerName),
        playerNum: normalizeString(member?.playerNumber),
        playerPhotoUrl: normalizeString(member?.playerPhotoUrl),
        relation: normalizeString(member?.relation) || 'Household contact',
        createdAt: timestamp,
        expiresAt,
        used: false,
        usedBy: null,
        usedAt: null,
        revoked: false
    });
    await updateDoc(doc(db, 'users', userId, 'familyMemberships', membershipRef.id), {
        accessCodeId: accessCodeRef.id,
        accessCode: code,
        inviteUrl: `accept-invite.html?code=${code}`,
        updatedAt: timestamp
    });

    return { code, inviteUrl: `accept-invite.html?code=${code}` };
}


async function revokeAccessCode(firebase, member, timestamp) {
    const { db, doc, updateDoc, collection, query, where, getDocs } = firebase;
    const payload = {
        revoked: true,
        revokedAt: timestamp,
        used: true,
        updatedAt: timestamp
    };
    if (member.accessCodeId && doc && updateDoc) {
        await updateDoc(doc(db, 'accessCodes', member.accessCodeId), payload);
        return;
    }
    if (member.inviteCode && collection && query && where && getDocs && updateDoc) {
        const snapshot = await getDocs(query(collection(db, 'accessCodes'), where('code', '==', member.inviteCode.toUpperCase())));
        await Promise.all(snapshot.docs.map((codeDoc) => updateDoc(codeDoc.ref, payload)));
    }
}

export async function removeFamilyMember(userId, memberId, { deps = {} } = {}) {
    if (!userId || !memberId) throw new Error('Missing family member to remove.');
    const firebase = await loadFirebase(deps);
    const { db, doc, getDoc, updateDoc, serverTimestamp } = firebase;
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();
    const memberRef = doc(db, 'users', userId, 'familyMemberships', memberId);
    const memberSnap = getDoc ? await getDoc(memberRef) : null;
    const member = normalizeFamilyMembers([{ id: memberId, ...dataFromSnapshot(memberSnap) }])[0] || { id: memberId };

    await revokeAccessCode(firebase, member, timestamp);
    await updateDoc(memberRef, {
        status: 'removed',
        accessStatus: 'revoked',
        updatedAt: timestamp,
        removedAt: timestamp,
    });
}

export async function loadFamilyPlanState(user, { deps = {}, entitlementReader = readAccountPremiumEntitlement } = {}) {
    const [members, invites, entitlement] = await Promise.all([
        readFamilyMembers(user?.uid, { deps }),
        readHouseholdInvites(user?.uid, { deps }),
        entitlementReader({ user, deps }),
    ]);
    return {
        members,
        invites,
        entitlementState: entitlement?.state || 'locked',
    };
}

export async function renderFamilyPlanSection(container, user, options = {}) {
    if (!container) return;
    const { deps = {}, entitlementReader = readAccountPremiumEntitlement } = options;

    try {
        const playerLinks = normalizePlayerLinks(options.playerLinks || options.linkedPlayers || []);
        const state = {
            ...(await loadFamilyPlanState(user, { deps, entitlementReader })),
            playerLinks,
            linkedPlayers: playerLinks
        };
        container.innerHTML = buildFamilyPlanSectionMarkup(state);

        const addButton = container.querySelector('#family-plan-add-member-btn');
        const validationEl = container.querySelector('#family-plan-validation');
        container.querySelectorAll('[data-family-plan-remove]').forEach((button) => {
            button.addEventListener('click', async () => {
                const memberId = button.getAttribute('data-family-plan-remove');
                button.textContent = 'Removing...';
                button.disabled = true;
                try {
                    await removeFamilyMember(user.uid, memberId, { deps });
                    await renderFamilyPlanSection(container, user, options);
                } catch (error) {
                    if (validationEl) {
                        validationEl.textContent = error.message || 'Unable to remove family member.';
                        validationEl.className = 'text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200';
                    }
                    button.textContent = 'Remove';
                    button.disabled = false;
                }
            });
        });

        addButton?.addEventListener('click', async () => {
            const emailEl = container.querySelector('#family-plan-member-email');
            const nameEl = container.querySelector('#family-plan-member-name');
            const originalText = addButton.textContent;
            addButton.disabled = true;
            addButton.textContent = 'Saving...';
            try {
                const selectedPlayerKey = container.querySelector('#family-plan-player-link')?.value || '';
                const selectedPlayer = playerLinks.find((link) => `${link.teamId}::${link.playerId}` === selectedPlayerKey) || {};
                await addPendingFamilyMember(user.uid, {
                    email: emailEl?.value,
                    displayName: nameEl?.value,
                    relation: container.querySelector('#family-plan-member-relation')?.value,
                    ...selectedPlayer,
                }, { deps, existingMembers: state.members });
                await renderFamilyPlanSection(container, user, options);
            } catch (error) {
                if (validationEl) {
                    validationEl.textContent = error.message || 'Unable to add family member.';
                    validationEl.className = 'text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200';
                }
                addButton.disabled = false;
                addButton.textContent = originalText;
            }
        });

        const householdValidationEl = container.querySelector('#household-invite-validation');
        container.querySelectorAll('[data-household-invite-revoke]').forEach((button) => {
            button.addEventListener('click', async () => {
                const inviteId = button.getAttribute('data-household-invite-revoke');
                button.textContent = 'Revoking...';
                button.disabled = true;
                try {
                    await removePendingHouseholdInvite(user.uid, inviteId, { deps });
                    await renderFamilyPlanSection(container, user, options);
                } catch (error) {
                    if (householdValidationEl) {
                        householdValidationEl.textContent = error.message || 'Unable to revoke household invite.';
                        householdValidationEl.className = 'text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200';
                    }
                    button.textContent = 'Revoke';
                    button.disabled = false;
                }
            });
        });

        const householdButton = container.querySelector('#household-invite-add-btn');
        householdButton?.addEventListener('click', async () => {
            const originalText = householdButton.textContent;
            householdButton.disabled = true;
            householdButton.textContent = 'Saving...';
            try {
                await addPendingHouseholdInvite(user.uid, {
                    playerKey: container.querySelector('#household-invite-player')?.value,
                    contactName: container.querySelector('#household-invite-name')?.value,
                    email: container.querySelector('#household-invite-email')?.value,
                    relation: container.querySelector('#household-invite-relation')?.value,
                    teamAccessIntent: container.querySelector('#household-invite-team-access')?.checked === true,
                }, { deps, linkedPlayers: state.linkedPlayers });
                await renderFamilyPlanSection(container, user, options);
            } catch (error) {
                if (householdValidationEl) {
                    householdValidationEl.textContent = error.message || 'Unable to create household invite.';
                    householdValidationEl.className = 'text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200';
                }
                householdButton.disabled = false;
                householdButton.textContent = originalText;
            }
        });

    } catch (error) {
        console.error('[family-plan] Unable to load Family Plan section:', error);
        container.innerHTML = '<div class="p-6 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-800">Family Plan could not be loaded right now.</div>';
    }
}
