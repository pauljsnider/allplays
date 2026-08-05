import { isSupportedTeamMediaDocument as legacyIsSupportedTeamMediaDocument } from '@legacy/team-media-utils.js';
import { validateTeamMediaUploadBatch as legacyValidateTeamMediaUploadBatch } from '@legacy/team-media-upload-limits.js';

export function isSupportedTeamMediaDocument(file: File): boolean {
    return legacyIsSupportedTeamMediaDocument(file);
}

export function validateTeamMediaUploadBatch(files: File[]): { valid: boolean; message: string } {
    return legacyValidateTeamMediaUploadBatch(files);
}
