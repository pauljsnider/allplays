import { NOTIFICATION_PREFERENCE_GROUPS as legacyNotificationPreferenceGroups } from '@legacy/notification-preferences.js';

export type LegacyNotificationPreferenceCategory = {
    id: string;
    label: string;
};

export type LegacyNotificationPreferenceGroup = {
    id: string;
    label: string;
    categories: readonly LegacyNotificationPreferenceCategory[];
};

export const NOTIFICATION_PREFERENCE_GROUPS = legacyNotificationPreferenceGroups as readonly LegacyNotificationPreferenceGroup[];
