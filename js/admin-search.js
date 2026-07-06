export function normalizeAdminSearchTerm(value = '') {
    return String(value || '').trim().toLowerCase();
}

export function hasAdminGlobalSearchTerm(value = '') {
    return normalizeAdminSearchTerm(value).length > 0;
}

export function selectAdminSearchCollection({ searchTerm = '', pageItems = [], globalItems = [] } = {}) {
    return hasAdminGlobalSearchTerm(searchTerm) ? globalItems : pageItems;
}
