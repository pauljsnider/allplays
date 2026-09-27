export const TEAM_MEDIA_MAX_BATCH_FILE_COUNT = 20;
export const TEAM_MEDIA_MAX_BATCH_SIZE_BYTES = 100 * 1024 * 1024;
export const TEAM_MEDIA_BATCH_LIMIT_MESSAGE = 'Upload up to 20 files and 100 MiB per batch. Split this selection into smaller batches and try again.';

export function validateTeamMediaUploadBatch(files = []) {
    const selectedFiles = Array.isArray(files) ? files : Array.from(files || []);
    if (selectedFiles.length > TEAM_MEDIA_MAX_BATCH_FILE_COUNT) {
        return { valid: false, message: TEAM_MEDIA_BATCH_LIMIT_MESSAGE };
    }

    let totalBytes = 0;
    for (const file of selectedFiles) {
        const size = file?.size;
        if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
            return { valid: false, message: TEAM_MEDIA_BATCH_LIMIT_MESSAGE };
        }
        totalBytes += size;
        if (!Number.isFinite(totalBytes) || totalBytes > TEAM_MEDIA_MAX_BATCH_SIZE_BYTES) {
            return { valid: false, message: TEAM_MEDIA_BATCH_LIMIT_MESSAGE };
        }
    }

    return { valid: true, message: '' };
}
