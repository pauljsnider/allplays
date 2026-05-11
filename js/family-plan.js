import { readAccountPremiumEntitlement } from './premium-entitlements.js?v=1';

export const MAX_FAMILY_PLAN_SLOTS = 4;

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
    const status = normalizeString(value).toLowerCase();
    return ['pending', 'active', 'removed'].includes(status) ? status : 'pending';
}

function loadFirebase(deps = {}) {
    if (deps.firebase) return Promise.resolve(deps.firebase);
    return import('./firebase.js?v=11');
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

export function buildFamilyPlanMarkup({ members = [], entitlementState = 'locked', validationMessage = '' } = {}) {
    const normalized = normalizeFamilyMembers(members);
    const counts = getFamilySlotCounts(normalized);
    const slotsFull = counts.used >= counts.max;
    const entitlementActive = entitlementState === 'unlocked';
    const rows = normalized.length
        ? normalized.map((member) => {
            const label = member.displayName || member.email || 'Family member';
            const subline = member.displayName && member.email ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(member.email)}</div>` : '';
            const accessLine = member.playerAccess.length
                ? `<div class="text-xs text-gray-500 mt-1">Access: ${escapeHtml(member.playerAccess.map((link) => `${link.playerName || link.playerId}${link.teamName ? ` (${link.teamName})` : ''}`).join(', '))}</div>`
                : '';
            const removeButton = member.status === 'removed'
                ? ''
                : `<button type="button" data-family-plan-remove="${escapeHtml(member.id)}" class="text-xs font-semibold text-red-600 hover:text-red-700">Revoke access</button>`;
            return `
                <div class="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
                    <div>
                        <div class="font-semibold text-gray-900">${escapeHtml(label)}</div>
                        ${subline}
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
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input id="family-plan-member-name" type="text" placeholder="Name (optional)" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                    <input id="family-plan-member-email" type="email" placeholder="Email for pending invite" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" ${slotsFull ? 'disabled' : ''}>
                </div>
                <button id="family-plan-add-member-btn" class="w-full bg-primary-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed" ${slotsFull ? 'disabled' : ''}>Add pending member</button>
                <div id="family-plan-validation" class="${validationMessage || slotsFull ? '' : 'hidden'} text-xs rounded-lg px-3 py-2 ${validationMessage ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">${escapeHtml(validationMessage || `Family Plan is limited to ${MAX_FAMILY_PLAN_SLOTS} active accounts or pending invites.`)}</div>
            </div>
        </div>
    `;
}

export async function readFamilyMembers(userId, { deps = {} } = {}) {
    if (!userId) return [];
    const { db, collection, getDocs } = await loadFirebase(deps);
    const snapshot = await getDocs(collection(db, `users/${userId}/familyMemberships`));
    return normalizeFamilyMembers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...dataFromSnapshot(docSnap) })));
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

    const { db, collection, addDoc, serverTimestamp } = await loadFirebase(deps);
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();
    await addDoc(collection(db, `users/${userId}/familyMemberships`), {
        email,
        displayName,
        status: 'pending',
        organizerUserId: userId,
        invitedAt: timestamp,
        updatedAt: timestamp,
    });
}


function uniqueStrings(values = []) {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function removeRevokedLinksFromUserProfile(profile = {}, accessLinks = []) {
    const revokedKeys = new Set(accessLinks.map((link) => `${link.teamId}::${link.playerId}`));
    const parentOf = Array.isArray(profile.parentOf) ? profile.parentOf : [];
    const filteredParentOf = parentOf.filter((link) => !revokedKeys.has(`${link?.teamId || ''}::${link?.playerId || ''}`));
    const parentTeamIds = uniqueStrings(filteredParentOf.map((link) => link?.teamId));
    const parentPlayerKeys = uniqueStrings(filteredParentOf.map((link) => link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : ''));
    const roles = filteredParentOf.length === 0 && Array.isArray(profile.roles)
        ? profile.roles.filter((role) => role !== 'parent')
        : profile.roles;
    return roles
        ? { parentOf: filteredParentOf, parentTeamIds, parentPlayerKeys, roles }
        : { parentOf: filteredParentOf, parentTeamIds, parentPlayerKeys };
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

async function revokeHouseholdAccess(firebase, member, timestamp) {
    const { db, doc, getDoc, updateDoc } = firebase;
    const accessLinks = normalizeAccessLinks(member.playerAccess);
    if (!accessLinks.length) return;

    if (member.userId && doc && getDoc && updateDoc) {
        const memberUserRef = doc(db, 'users', member.userId);
        const memberUserSnap = await getDoc(memberUserRef);
        if (memberUserSnap.exists()) {
            await updateDoc(memberUserRef, {
                ...removeRevokedLinksFromUserProfile(dataFromSnapshot(memberUserSnap), accessLinks),
                updatedAt: timestamp
            });
        }
    }

    await Promise.all(accessLinks.map(async (link) => {
        const playerRef = doc(db, `teams/${link.teamId}/players`, link.playerId);
        const playerSnap = await getDoc(playerRef);
        if (!playerSnap.exists()) return;
        const playerData = dataFromSnapshot(playerSnap);
        const parents = Array.isArray(playerData.parents) ? playerData.parents : [];
        const filteredParents = parents.filter((parent) => {
            if (member.userId && parent?.userId === member.userId) return false;
            if (member.email && normalizeString(parent?.email).toLowerCase() === member.email.toLowerCase()) return false;
            return true;
        });
        await updateDoc(playerRef, { parents: filteredParents, updatedAt: timestamp });
    }));
}

export async function removeFamilyMember(userId, memberId, { deps = {} } = {}) {
    if (!userId || !memberId) throw new Error('Missing family member to remove.');
    const firebase = await loadFirebase(deps);
    const { db, doc, getDoc, updateDoc, serverTimestamp } = firebase;
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : new Date().toISOString();
    const memberRef = doc(db, 'users', userId, 'familyMemberships', memberId);
    const memberSnap = getDoc ? await getDoc(memberRef) : null;
    const member = normalizeFamilyMembers([{ id: memberId, ...dataFromSnapshot(memberSnap) }])[0] || { id: memberId };

    await updateDoc(memberRef, {
        status: 'removed',
        accessStatus: 'revoked',
        updatedAt: timestamp,
        removedAt: timestamp,
    });
    await revokeHouseholdAccess(firebase, member, timestamp);
    await revokeAccessCode(firebase, member, timestamp);
}

export async function loadFamilyPlanState(user, { deps = {}, entitlementReader = readAccountPremiumEntitlement } = {}) {
    const [members, entitlement] = await Promise.all([
        readFamilyMembers(user?.uid, { deps }),
        entitlementReader({ user, deps }),
    ]);
    return {
        members,
        entitlementState: entitlement?.state || 'locked',
    };
}

export async function renderFamilyPlanSection(container, user, options = {}) {
    if (!container) return;
    const { deps = {}, entitlementReader = readAccountPremiumEntitlement } = options;

    try {
        const state = await loadFamilyPlanState(user, { deps, entitlementReader });
        container.innerHTML = buildFamilyPlanMarkup(state);

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
                await addPendingFamilyMember(user.uid, {
                    email: emailEl?.value,
                    displayName: nameEl?.value,
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
    } catch (error) {
        console.error('[family-plan] Unable to load Family Plan section:', error);
        container.innerHTML = '<div class="p-6 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-800">Family Plan could not be loaded right now.</div>';
    }
}
