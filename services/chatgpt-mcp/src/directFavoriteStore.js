import { createDirectCommandStore } from './directCommandStore.js';
const favorite = /^teams\/[A-Za-z0-9_-]{1,128}\/drillFavorites\/[A-Za-z0-9_-]{1,128}$/;
export function createDirectFavoriteStore(options) {
    return createDirectCommandStore(options, {
        read: (path) => favorite.test(path) || /^(teams|drillLibrary)\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => favorite.test(path),
        delete: (path) => favorite.test(path)
    });
}
