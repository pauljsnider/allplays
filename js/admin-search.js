export function normalizeAdminSearchTerm(value = '') {
    return String(value || '').trim().toLowerCase();
}

export function hasAdminGlobalSearchTerm(value = '') {
    return normalizeAdminSearchTerm(value).length > 0;
}

export async function loadCompleteAdminSearchCollection({ fetchPage, itemsKey, pageSize = 100 } = {}) {
    if (typeof fetchPage !== 'function') {
        throw new TypeError('fetchPage must be a function');
    }

    const items = [];
    let cursor = null;

    do {
        const page = await fetchPage({
            pageSize,
            ...(cursor ? { cursor } : {})
        });
        items.push(...(Array.isArray(page?.[itemsKey]) ? page[itemsKey] : []));
        cursor = page?.nextCursor || null;
    } while (cursor);

    return items;
}

export function selectAdminSearchCollection({ searchTerm = '', pageItems = [], globalItems = [] } = {}) {
    return hasAdminGlobalSearchTerm(searchTerm) ? globalItems : pageItems;
}

export function selectAdminItemById({ id = '', pageItems = [], globalItems = [], fallbackItems = [] } = {}) {
    const itemId = String(id || '');
    return [...pageItems, ...globalItems, ...fallbackItems].find((item) => String(item?.id || '') === itemId) || null;
}
