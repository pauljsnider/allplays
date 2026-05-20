export function appendLivePracticeNote(block, text, type = 'text', nowIso = null) {
    if (!block) return false;
    const clean = (text || '').trim();
    if (!clean) return false;

    if (!Array.isArray(block.notesLog)) {
        block.notesLog = [];
    }

    block.notesLog.push({
        type,
        text: clean,
        createdAt: nowIso || new Date().toISOString()
    });
    return true;
}
