export function loadInsightsTab() {
  return import('./InsightsTab').then((module) => ({ default: module.InsightsTab }));
}
