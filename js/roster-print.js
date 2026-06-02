function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getRosterProfileValues(player = {}) {
    return {
        ...(player?.rosterFieldValues || {}),
        ...(player?.customFields || {}),
        ...(player?.profile?.rosterFields || {}),
        ...(player?.profile?.customFields || {})
    };
}

function isPrintableRosterField(field = {}) {
    const visibility = String(field.visibility || 'team').trim().toLowerCase();
    return field.active !== false && !['admin', 'admins', 'private', 'restricted'].includes(visibility);
}

function formatRosterFieldValue(field = {}, value) {
    if (value === null || value === undefined || value === '') return '';
    if (field.type === 'checkbox') return value === true ? 'Yes' : 'No';
    if (field.type === 'menu') {
        const option = (field.options || []).find((item) => String(item.value) === String(value));
        return option?.label || value;
    }
    return value;
}

function parseJerseyNumber(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return Number.POSITIVE_INFINITY;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function getContactSummary(player = {}, contactsByPlayerId = {}) {
    const keyedContacts = contactsByPlayerId instanceof Map
        ? contactsByPlayerId.get(player.id)
        : contactsByPlayerId?.[player.id];
    const contacts = Array.isArray(keyedContacts) ? keyedContacts : [];
    const playerContacts = Array.isArray(player.parents) ? player.parents : [];
    const combined = [...contacts, ...playerContacts]
        .filter((contact) => contact && contact.status !== 'removed')
        .map((contact) => {
            const label = contact.name || contact.displayName || contact.fullName || contact.email || 'Contact';
            const relation = contact.relation || contact.role || '';
            const email = contact.email && contact.email !== label ? contact.email : '';
            return [label, relation ? `(${relation})` : '', email].filter(Boolean).join(' ');
        })
        .filter(Boolean);
    return [...new Set(combined)].join('; ');
}

function normalizeStaffEntries(staff = []) {
    return (Array.isArray(staff) ? staff : [])
        .map((entry) => {
            const name = String(entry?.name || entry?.label || entry?.email || '').trim();
            const role = String(entry?.roleLabel || entry?.role || '').trim();
            const detail = String(entry?.detail || entry?.email || '').trim();
            if (!name) return null;
            return { name, role, detail };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name) || a.role.localeCompare(b.role));
}

export function buildRosterPrintViewModel({ team = {}, players = [], staff = [], includeStaff = false, fields = [], contactsByPlayerId = {}, generatedAt = new Date() } = {}) {
    const printableFields = (fields || []).filter(isPrintableRosterField);
    const activePlayers = (players || [])
        .filter((player) => player && player.active !== false)
        .map((player) => {
            const values = getRosterProfileValues(player);
            return {
                id: player.id,
                number: String(player.number ?? '').trim(),
                name: String(player.name || 'Unnamed player').trim(),
                contactSummary: getContactSummary(player, contactsByPlayerId),
                fields: printableFields
                    .map((field) => ({
                        key: field.key,
                        label: field.label,
                        value: formatRosterFieldValue(field, values[field.key])
                    }))
                    .filter((field) => String(field.value ?? '').trim() !== '')
            };
        })
        .sort((a, b) => parseJerseyNumber(a.number) - parseJerseyNumber(b.number)
            || a.name.localeCompare(b.name)
            || String(a.number).localeCompare(String(b.number)));
    const staffEntries = includeStaff ? normalizeStaffEntries(staff) : [];

    return {
        teamName: team.name || team.teamName || 'Team roster',
        generatedDate: generatedAt instanceof Date ? generatedAt.toLocaleString() : String(generatedAt || ''),
        activeCount: activePlayers.length,
        staffCount: staffEntries.length,
        fields: printableFields.map((field) => ({ key: field.key, label: field.label })),
        players: activePlayers,
        staff: staffEntries
    };
}

export function buildRosterPrintHtml(options = {}) {
    const model = buildRosterPrintViewModel(options);
    const fieldHeaders = model.fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('');
    const rows = model.players.map((player) => {
        const fieldCells = model.fields.map((field) => {
            const playerField = player.fields.find((item) => item.key === field.key);
            return `<td>${escapeHtml(playerField?.value || '')}</td>`;
        }).join('');
        return `<tr>
            <td>${escapeHtml(player.number || '-')}</td>
            <td>${escapeHtml(player.name)}</td>
            <td>${escapeHtml(player.contactSummary || 'None listed')}</td>
            ${fieldCells}
        </tr>`;
    }).join('');
    const staffRows = model.staff.map((entry) => `<tr>
            <td>${escapeHtml(entry.name)}</td>
            <td>${escapeHtml(entry.role || 'Staff')}</td>
            <td>${escapeHtml(entry.detail || '')}</td>
        </tr>`).join('');
    const staffSection = model.staffCount > 0 ? `
                <section class="roster-print-staff">
                    <h2>Staff</h2>
                    <p class="roster-print-meta">${model.staffCount} staff entr${model.staffCount === 1 ? 'y' : 'ies'}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Contact</th>
                            </tr>
                        </thead>
                        <tbody>${staffRows}</tbody>
                    </table>
                </section>
            ` : '';

    return {
        model,
        html: `
            <style>
                @media screen { #roster-print-root { display: none; } }
                @media print {
                    body > *:not(#roster-print-root) { display: none !important; }
                    #roster-print-root { display: block !important; color: #111827; font-family: Arial, sans-serif; padding: 24px; }
                    #roster-print-root table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    #roster-print-root th, #roster-print-root td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
                    #roster-print-root th { background: #f3f4f6; font-size: 12px; text-transform: uppercase; }
                    #roster-print-root .roster-print-meta { color: #4b5563; font-size: 13px; margin-top: 4px; }
                    #roster-print-root .roster-print-staff { margin-top: 24px; }
                    #roster-print-root .roster-print-staff h2 { font-size: 18px; margin: 0; }
                }
            </style>
            <section aria-label="Printable roster">
                <h1>${escapeHtml(model.teamName)} Roster</h1>
                <p class="roster-print-meta">Generated ${escapeHtml(model.generatedDate)} · ${model.activeCount} active player${model.activeCount === 1 ? '' : 's'}</p>
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Player</th>
                            <th>Parent / contact summary</th>
                            ${fieldHeaders}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                ${staffSection}
            </section>
        `
    };
}
