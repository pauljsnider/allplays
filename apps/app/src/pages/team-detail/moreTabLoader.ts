export function loadMoreTab() {
  return import('./MoreTab').then((module) => ({ default: module.MoreTab }));
}
