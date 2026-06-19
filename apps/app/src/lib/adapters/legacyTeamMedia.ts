import { isSupportedTeamMediaDocument as legacyIsSupportedTeamMediaDocument } from '@legacy/team-media-utils.js';

export function isSupportedTeamMediaDocument(file: File): boolean {
    return legacyIsSupportedTeamMediaDocument(file);
}
