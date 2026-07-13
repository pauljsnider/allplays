function isImageFile(file) {
    return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

function getImageFileFromItems(items = []) {
    return Array.from(items)
        .map((item) => {
            if (!item || typeof item.type !== 'string' || !item.type.startsWith('image/')) return null;
            return typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        })
        .find(isImageFile) || null;
}

export function getClipboardImageFile(event) {
    return getImageFileFromItems(event?.clipboardData?.items || []);
}

export function getDroppedImageFile(event) {
    return Array.from(event?.dataTransfer?.files || []).find(isImageFile) || null;
}

function hasDraggedImage(event) {
    const items = Array.from(event?.dataTransfer?.items || []);
    if (items.some((item) => typeof item?.type === 'string' && item.type.startsWith('image/'))) {
        return true;
    }
    return Boolean(getDroppedImageFile(event));
}

function isEditablePasteTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
}

function isBulkAiContainerActive(container) {
    return Boolean(container && container.isConnected !== false && !container.classList.contains('hidden'));
}

export function createBulkAiImageController({
    imageInput,
    preview,
    previewImage,
    removeButton,
    FileReaderCtor = globalThis.FileReader
} = {}) {
    let bulkAiImageFile = null;

    function renderImagePreview(file) {
        if (!preview || !previewImage) return;

        if (!FileReaderCtor) {
            preview.classList.remove('hidden');
            return;
        }

        const reader = new FileReaderCtor();
        reader.onload = (event) => {
            const result = event?.target?.result ?? reader.result;
            previewImage.src = typeof result === 'string' ? result : '';
            preview.classList.remove('hidden');
        };
        reader.onerror = () => {
            previewImage.removeAttribute('src');
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    function setBulkAiImage(file) {
        if (!isImageFile(file)) return false;
        bulkAiImageFile = file;
        renderImagePreview(file);
        return true;
    }

    function clearBulkAiImage() {
        bulkAiImageFile = null;
        if (imageInput) imageInput.value = '';
        if (previewImage) previewImage.removeAttribute('src');
        if (preview) preview.classList.add('hidden');
    }

    function getBulkAiImageFile() {
        return bulkAiImageFile || imageInput?.files?.[0] || null;
    }

    function handleBulkAiImageInputChange(event) {
        const file = event?.target?.files?.[0] || null;
        return setBulkAiImage(file);
    }

    function handleBulkAiImagePaste(event) {
        const file = getClipboardImageFile(event);
        if (!file) return false;

        event.preventDefault();
        event.stopPropagation?.();
        return setBulkAiImage(file);
    }

    function handleBulkAiImageDragOver(event) {
        if (!hasDraggedImage(event)) return false;

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        return true;
    }

    function handleBulkAiImageDrop(event) {
        const file = getDroppedImageFile(event);
        if (!file) return false;

        event.preventDefault();
        event.stopPropagation?.();
        return setBulkAiImage(file);
    }

    function bindBulkAiImageControls({ container, textInput, documentTarget = globalThis.document } = {}) {
        imageInput?.addEventListener('change', handleBulkAiImageInputChange);
        removeButton?.addEventListener('click', clearBulkAiImage);

        const pasteTargets = new Set([textInput, container].filter(Boolean));
        pasteTargets.forEach((target) => target.addEventListener('paste', handleBulkAiImagePaste));

        const handlePagePaste = (event) => {
            if (!isBulkAiContainerActive(container)) return false;
            if (container.contains(event.target)) return false;
            if (isEditablePasteTarget(event.target)) return false;
            return handleBulkAiImagePaste(event);
        };
        documentTarget?.addEventListener?.('paste', handlePagePaste);

        container?.addEventListener('dragover', handleBulkAiImageDragOver);
        container?.addEventListener('drop', handleBulkAiImageDrop);

        return () => {
            imageInput?.removeEventListener('change', handleBulkAiImageInputChange);
            removeButton?.removeEventListener('click', clearBulkAiImage);
            pasteTargets.forEach((target) => target.removeEventListener('paste', handleBulkAiImagePaste));
            documentTarget?.removeEventListener?.('paste', handlePagePaste);
            container?.removeEventListener('dragover', handleBulkAiImageDragOver);
            container?.removeEventListener('drop', handleBulkAiImageDrop);
        };
    }

    return {
        bindBulkAiImageControls,
        clearBulkAiImage,
        getBulkAiImageFile,
        handleBulkAiImageDrop,
        handleBulkAiImageInputChange,
        handleBulkAiImagePaste,
        setBulkAiImage
    };
}

export function normalizeBulkAiEventType(value) {
    return String(value || '').trim().toLowerCase() === 'practice' ? 'practice' : 'game';
}

export function normalizeBulkAiAssignments(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((a) => ({
            role: String(a?.role || '').trim(),
            value: String(a?.value || '').trim()
        }))
        .filter((a) => a.role);
}

export function normalizeBulkAiIsHome(value) {
    if (value === true || value === false || value === null) return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'home') return true;
        if (normalized === 'away') return false;
        if (normalized === '' || normalized === 'unknown' || normalized === 'null') return null;
    }
    return null;
}

export function normalizeBulkAiEventForAdd(event) {
    const eventType = normalizeBulkAiEventType(event?.eventType);
    const normalized = {
        ...event,
        eventType,
        date: event?.date ? String(event.date).trim() : '',
        location: event?.location ? String(event.location).trim() : '',
        notes: event?.notes ? String(event.notes).trim() : null,
        assignments: normalizeBulkAiAssignments(event?.assignments || []),
        status: event?.status || 'scheduled'
    };

    if (eventType === 'practice') {
        return {
            ...normalized,
            title: event?.title ? String(event.title).trim() : 'Practice',
            opponent: null,
            endTime: event?.endTime ? String(event.endTime).trim() : null,
            arrivalTime: event?.arrivalTime ? String(event.arrivalTime).trim() : null
        };
    }

    const normalizedIsHome = normalizeBulkAiIsHome(event?.isHome);
    const opponent = event?.opponent ? String(event.opponent).trim() : '';
    if (!opponent) {
        throw new Error('Game opponent is required.');
    }
    const rawKitColor = typeof event?.kitColor === 'string' ? event.kitColor.trim() : '';
    const kitColor = rawKitColor || (normalizedIsHome === true ? 'Home kit' : (normalizedIsHome === false ? 'Away kit' : 'TBD kit'));
    return {
        ...normalized,
        opponent,
        isHome: normalizedIsHome,
        kitColor,
        arrivalTime: event?.arrivalTime ? String(event.arrivalTime).trim() : null,
        homeScore: Number.isFinite(Number(event?.homeScore)) ? Number(event.homeScore) : 0,
        awayScore: Number.isFinite(Number(event?.awayScore)) ? Number(event.awayScore) : 0
    };
}

export function buildBulkAiPracticePayload(event, {
    Timestamp,
    getDefaultEndTime,
    userId = null
} = {}) {
    if (!Timestamp || typeof Timestamp.fromDate !== 'function' || typeof getDefaultEndTime !== 'function') {
        throw new Error('buildBulkAiPracticePayload requires Timestamp and getDefaultEndTime helpers');
    }

    const normalized = normalizeBulkAiEventForAdd({ ...event, eventType: 'practice' });
    const startDate = new Date(normalized.date);
    if (Number.isNaN(startDate.getTime())) {
        throw new Error('Practice date is required.');
    }
    const endDate = normalized.endTime ? new Date(normalized.endTime) : getDefaultEndTime(startDate, 'practice');
    if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        throw new Error('Practice end time must be a valid date.');
    }
    if (endDate.getTime() <= startDate.getTime()) {
        throw new Error('Practice end time must be after the start time.');
    }

    const arrivalDate = normalized.arrivalTime ? new Date(normalized.arrivalTime) : null;
    if (arrivalDate && Number.isNaN(arrivalDate.getTime())) {
        throw new Error('Practice arrival time must be a valid date.');
    }

    return {
        title: normalized.title || 'Practice',
        date: Timestamp.fromDate(startDate),
        end: Timestamp.fromDate(endDate),
        location: normalized.location || '',
        notes: normalized.notes,
        arrivalTime: arrivalDate ? Timestamp.fromDate(arrivalDate) : null,
        assignments: normalized.assignments,
        source: 'bulk_ai',
        sourceMetadata: {
            importedBy: userId || null,
            importedFrom: 'edit-schedule-bulk-ai'
        }
    };
}
