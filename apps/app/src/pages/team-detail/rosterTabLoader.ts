export function loadRosterTab() {
  return import('./RosterTab').then((module) => ({ default: module.RosterTab }));
}
