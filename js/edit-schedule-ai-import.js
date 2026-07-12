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

    function bindBulkAiImageControls({ container, textInput } = {}) {
        imageInput?.addEventListener('change', handleBulkAiImageInputChange);
        removeButton?.addEventListener('click', clearBulkAiImage);

        const pasteTargets = new Set([textInput, container].filter(Boolean));
        pasteTargets.forEach((target) => target.addEventListener('paste', handleBulkAiImagePaste));

        container?.addEventListener('dragover', handleBulkAiImageDragOver);
        container?.addEventListener('drop', handleBulkAiImageDrop);

        return () => {
            imageInput?.removeEventListener('change', handleBulkAiImageInputChange);
            removeButton?.removeEventListener('click', clearBulkAiImage);
            pasteTargets.forEach((target) => target.removeEventListener('paste', handleBulkAiImagePaste));
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
