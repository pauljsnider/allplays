import { escapeHtml, getUrlParams, renderFooter, renderHeader } from './utils.js?v=15';

const VISIBILITY_VALUES = ['private', 'public'];
const STATUS_VALUES = ['active', 'archived'];

function normalizeString(value) {
    return String(value || '').trim();
}

export function isTrackingItemAdmin(team, user = {}, canModerateChat = null) {
    if (!team || !user) return false;
    if (user.isAdmin === true) return true;
    if (team.ownerId && user.uid && team.ownerId === user.uid) return true;
    if (typeof canModerateChat === 'function' && canModerateChat(team, user)) return true;

    const email = normalizeString(user.email || user.profileEmail).toLowerCase();
    if (!email) return false;

    return (team.adminEmails || [])
        .map((adminEmail) => normalizeString(adminEmail).toLowerCase())
        .includes(email);
}

export function normalizeTrackingItemDraft(formValues = {}) {
    const name = normalizeString(formValues.name);
    const description = normalizeString(formValues.description);
    const visibility = VISIBILITY_VALUES.includes(formValues.visibility) ? formValues.visibility : 'private';
    const status = STATUS_VALUES.includes(formValues.status) ? formValues.status : 'active';

    if (!name) throw new Error('Tracking item name is required.');

    return {
        name,
        description,
        visibility,
        status,
        archived: status === 'archived',
        active: status === 'active'
    };
}

export function filterTrackingItemsForAdminList(items = [], { includeArchived = false } = {}) {
    return (items || [])
        .filter((item) => includeArchived || normalizeTrackingItemStatus(item) !== 'archived')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function normalizeTrackingItemStatus(item = {}) {
    if (item.status === 'archived' || item.archived === true || item.active === false) return 'archived';
    return 'active';
}

function formatVisibilityLabel(visibility) {
    return visibility === 'public' ? 'Public' : 'Private';
}

function renderShell({ team }) {
    return `
        <div class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <p class="text-sm font-semibold uppercase tracking-wide text-primary-600">Team admin</p>
                <h1 class="text-3xl font-bold text-gray-900">Tracking checklist items</h1>
                <p class="mt-1 text-sm text-gray-600">${escapeHtml(team.name || 'Team')} · Create reusable forms, tasks, and compliance checklist items.</p>
            </div>
            <a href="dashboard.html" class="text-sm font-semibold text-primary-700 hover:text-primary-900">Back to dashboard</a>
        </div>

        <div id="tracking-item-message" class="mb-4 hidden rounded-lg p-3 text-sm"></div>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 class="text-xl font-bold text-gray-900">Items</h2>
                        <p class="text-sm text-gray-500">Archived items are hidden by default.</p>
                    </div>
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                        <input id="show-archived-tracking-items" type="checkbox" class="rounded border-gray-300 text-primary-600">
                        Show archived
                    </label>
                </div>
                <div id="tracking-items-list" class="space-y-3">
                    <p class="text-sm text-gray-500">Loading tracking items...</p>
                </div>
            </section>

            <form id="tracking-item-form" class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hidden">
                <input id="tracking-item-id" type="hidden">
                <h2 id="tracking-item-form-title" class="mb-4 text-xl font-bold text-gray-900">Create item</h2>
                <div class="space-y-4">
                    <div>
                        <label for="tracking-item-name" class="block text-sm font-medium text-gray-700">Name</label>
                        <input id="tracking-item-name" required class="mt-1 w-full rounded border border-gray-300 p-2" placeholder="Medical release form">
                    </div>
                    <div>
                        <label for="tracking-item-description" class="block text-sm font-medium text-gray-700">Description</label>
                        <textarea id="tracking-item-description" rows="4" class="mt-1 w-full rounded border border-gray-300 p-2" placeholder="Optional instructions for admins or families"></textarea>
                    </div>
                    <div>
                        <label for="tracking-item-visibility" class="block text-sm font-medium text-gray-700">Visibility</label>
                        <select id="tracking-item-visibility" class="mt-1 w-full rounded border border-gray-300 p-2">
                            <option value="private">Private admin-only</option>
                            <option value="public">Public to team members</option>
                        </select>
                    </div>
                    <div>
                        <label for="tracking-item-status" class="block text-sm font-medium text-gray-700">Status</label>
                        <select id="tracking-item-status" class="mt-1 w-full rounded border border-gray-300 p-2">
                            <option value="active">Active</option>
                            <option value="archived">Archived</option>
                        </select>
                    </div>
                    <div class="flex gap-2">
                        <button type="submit" class="flex-1 rounded bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700">Save item</button>
                        <button id="tracking-item-cancel" type="button" class="rounded border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">Reset</button>
                    </div>
                </div>
            </form>
            <div id="add-item-button-container" class="mt-4 lg:col-start-2">
                <button id="add-new-tracking-item-button" type="button" class="w-full rounded bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700">Add new item</button>
            </div>
        </div>
    `;
}

function showMessage(message, type = 'success') {
    const el = document.getElementById('tracking-item-message');
    if (!el) return;
    el.textContent = message;
    el.className = `mb-4 rounded-lg p-3 text-sm ${type === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-green-200 bg-green-50 text-green-700'}`;
}

function resetForm() {
    document.getElementById('tracking-item-id').value = '';
    document.getElementById('tracking-item-name').value = '';
    document.getElementById('tracking-item-description').value = '';
    document.getElementById('tracking-item-visibility').value = 'private';
    document.getElementById('tracking-item-status').value = 'active';
    document.getElementById('tracking-item-form-title').textContent = 'Create item';
}

function populateForm(item) {
    document.getElementById('tracking-item-id').value = item.id || '';
    document.getElementById('tracking-item-name').value = item.name || '';
    document.getElementById('tracking-item-description').value = item.description || '';
    document.getElementById('tracking-item-visibility').value = item.visibility === 'public' ? 'public' : 'private';
    document.getElementById('tracking-item-status').value = normalizeTrackingItemStatus(item);
    document.getElementById('tracking-item-form-title').textContent = 'Edit item';
}

function renderList(items, { includeArchived = false, onEdit, onArchive }) {
    const list = document.getElementById('tracking-items-list');
    const visibleItems = filterTrackingItemsForAdminList(items, { includeArchived });

    if (!visibleItems.length) {
        list.innerHTML = `<p class="text-sm text-gray-500">${includeArchived ? 'No tracking items yet.' : 'No active tracking items yet.'}</p>`;
        return;
    }

    list.innerHTML = visibleItems.map((item) => {
        const status = normalizeTrackingItemStatus(item);
        return `
            <article class="rounded-xl border border-gray-200 p-4" data-item-id="${escapeHtml(item.id)}">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h3 class="font-semibold text-gray-900">${escapeHtml(item.name || 'Untitled item')}</h3>
                        <p class="mt-1 text-sm text-gray-600">${escapeHtml(item.description || 'No description.')}</p>
                        <div class="mt-2 flex flex-wrap gap-2 text-xs">
                            <span class="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">${formatVisibilityLabel(item.visibility)}</span>
                            <span class="rounded-full ${status === 'archived' ? 'bg-gray-100 text-gray-700' : 'bg-green-50 text-green-700'} px-2 py-1 font-semibold">${status === 'archived' ? 'Archived' : 'Active'}</span>
                        </div>
                    </div>
                    <div class="flex shrink-0 gap-2">
                        <button type="button" data-action="edit" class="text-sm font-semibold text-primary-700 hover:text-primary-900">Edit</button>
                        ${status === 'active' ? '<button type="button" data-action="archive" class="text-sm font-semibold text-red-600 hover:text-red-800">Archive</button>' : ''}
                    </div>
                </div>
            </article>
        `;
    }).join('');

    list.querySelectorAll('[data-action="edit"]').forEach((button) => {
        button.addEventListener('click', () => {
            const itemId = button.closest('[data-item-id]')?.dataset?.itemId;
            const item = items.find((candidate) => candidate.id === itemId);
            if (item) onEdit(item);
        });
    });
    list.querySelectorAll('[data-action="archive"]').forEach((button) => {
        button.addEventListener('click', () => {
            const itemId = button.closest('[data-item-id]')?.dataset?.itemId;
            const item = items.find((candidate) => candidate.id === itemId);
            if (item) onArchive(item);
        });
    });
}

async function initTrackingItemsAdminPage() {
    if (typeof document === 'undefined') return;

    const container = document.getElementById('tracking-items-admin-root');
    if (!container) return;

    renderFooter(document.getElementById('footer-container'));

    const [dbModule, authModule, firebaseModule] = await Promise.all([
        import('./db.js?v=91'),
        import('./auth.js?v=50'),
        import('./firebase.js?v=20')
    ]);
    const { getTeam, getUserProfile, canModerateChat } = dbModule;
    const { requireAuth } = authModule;
    const { db, collection, getDocs, doc, setDoc, updateDoc, serverTimestamp } = firebaseModule;

    try {
        const user = await requireAuth();
        try {
            const profile = await getUserProfile(user.uid);
            if (profile?.isAdmin) user.isAdmin = true;
            if (profile?.email) user.profileEmail = profile.email;
        } catch (error) {
            console.warn('[tracking-items] Unable to load profile:', error);
        }

        renderHeader(document.getElementById('header-container'), user);

        const params = getUrlParams();
        const teamId = params.teamId || '';
        if (!teamId) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Missing teamId.</div>';
            return;
        }

        const team = await getTeam(teamId, { includeInactive: true });
        if (!team) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Team not found.</div>';
            return;
        }

        if (!isTrackingItemAdmin(team, user, canModerateChat)) {
            container.innerHTML = `
                <div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
                    <h1 class="mb-2 text-2xl font-bold">Tracking items are admin-only</h1>
                    <p>Only team owners, team admins, and global admins can create, edit, or archive tracking items.</p>
                </div>
            `;
            return;
        }

        let items = [];
        container.innerHTML = renderShell({ team });

        const trackingItemForm = document.getElementById('tracking-item-form');
        const addNewItemButton = document.getElementById('add-new-tracking-item-button');

        if (!trackingItemForm || !addNewItemButton) {
            console.error('[tracking-items] Required form elements not found');
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Unable to initialize form.</div>';
            return;
        }

        const showFormAndHideButton = () => {
            trackingItemForm.classList.remove('hidden');
            addNewItemButton.classList.add('hidden');
        };

        const hideFormAndShowButton = () => {
            trackingItemForm.classList.add('hidden');
            addNewItemButton.classList.remove('hidden');
        };

        addNewItemButton.addEventListener('click', () => {
            showFormAndHideButton();
            resetForm();
        });

        const includeArchivedInput = document.getElementById('show-archived-tracking-items');
        const refreshList = () => renderList(items, {
            includeArchived: includeArchivedInput.checked,
            onEdit: (item) => { showFormAndHideButton(); populateForm(item); },
            onArchive: async (item) => {
                if (!confirm(`Archive "${item.name || 'this item'}"?`)) return;
                await updateDoc(doc(db, `teams/${teamId}/trackingItems`, item.id), {
                    status: 'archived',
                    archived: true,
                    active: false,
                    updatedAt: serverTimestamp(),
                    updatedBy: user.uid
                });
                showMessage('Tracking item archived.');
                await loadItems();
                resetForm();
                hideFormAndShowButton();
            }
        });

        async function loadItems() {
            const snapshot = await getDocs(collection(db, `teams/${teamId}/trackingItems`));
            items = snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            refreshList();
        }

        includeArchivedInput.addEventListener('change', refreshList);
        document.getElementById('tracking-item-cancel').addEventListener('click', () => { resetForm(); hideFormAndShowButton(); });
        document.getElementById('tracking-item-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const itemId = document.getElementById('tracking-item-id').value;
            let draft;
            try {
                draft = normalizeTrackingItemDraft({
                    name: document.getElementById('tracking-item-name').value,
                    description: document.getElementById('tracking-item-description').value,
                    visibility: document.getElementById('tracking-item-visibility').value,
                    status: document.getElementById('tracking-item-status').value
                });
            } catch (error) {
                showMessage(error.message, 'error');
                return;
            }

            try {
                if (itemId) {
                    await updateDoc(doc(db, `teams/${teamId}/trackingItems`, itemId), {
                        ...draft,
                        teamId,
                        updatedAt: serverTimestamp(),
                        updatedBy: user.uid
                    });
                    showMessage('Tracking item updated.');
                } else {
                    const itemRef = doc(collection(db, `teams/${teamId}/trackingItems`));
                    await setDoc(itemRef, {
                        ...draft,
                        teamId,
                        createdAt: serverTimestamp(),
                        createdBy: user.uid,
                        updatedAt: serverTimestamp(),
                        updatedBy: user.uid
                    });
                    showMessage('Tracking item created.');
                }
                await loadItems();
                resetForm();
                hideFormAndShowButton();
            } catch (error) {
                console.error('[tracking-items] save failed:', error);
                showMessage('Unable to save tracking item.', 'error');
            }
        });

        await loadItems();
    } catch (error) {
        console.error('[tracking-items] init failed:', error);
        container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Unable to load tracking items.</div>';
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initTrackingItemsAdminPage);
}
