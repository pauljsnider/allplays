import { toBlob as htmlToImageBlob } from '../vendor/html-to-image/index.js';

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cleanupAfterPrint(cleanup) {
    let hasCleaned = false;
    const runCleanup = () => {
        if (hasCleaned) return;
        hasCleaned = true;
        window.removeEventListener('afterprint', runCleanup);
        cleanup();
    };

    window.addEventListener('afterprint', runCleanup, { once: true });
    setTimeout(runCleanup, 60000);
}

function slugify(value) {
    return String(value || 'certificate')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'certificate';
}

export function getCertificateFilename({ teamName = 'team', recipientName = 'recipient', seasonLabel = 'season', extension = 'png' } = {}) {
    return `${slugify(teamName)}-${slugify(recipientName)}-${slugify(seasonLabel)}.${extension}`;
}

async function waitForImages(node) {
    const images = Array.from(node.querySelectorAll('img'));
    await Promise.all(images.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => reject(new Error(`Image failed to load: ${img.src}`)), { once: true });
        });
    }));
}

async function blobToDataUrl(blob) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Unable to read image data.'));
        reader.readAsDataURL(blob);
    });
}

async function fetchImageAsDataUrl(src) {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return src;
    const response = await fetch(src, { mode: 'cors' });
    if (!response.ok) {
        throw new Error(`Image failed to load for export: ${src}`);
    }
    return await blobToDataUrl(await response.blob());
}

async function inlineImageSources(clone) {
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(images.map(async (img) => {
        const src = img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        const absoluteSrc = new URL(src, window.location.href).toString();
        img.setAttribute('src', await fetchImageAsDataUrl(absoluteSrc));
        img.removeAttribute('crossorigin');
    }));
}

function inlineComputedStyles(source, target) {
    const computed = window.getComputedStyle(source);
    target.setAttribute('style', computed.cssText);

    Array.from(source.children).forEach((sourceChild, index) => {
        const targetChild = target.children[index];
        if (targetChild) inlineComputedStyles(sourceChild, targetChild);
    });
}

async function cloneForCanvas(node) {
    await document.fonts?.ready;
    await waitForImages(node);
    const clone = node.cloneNode(true);
    inlineComputedStyles(node, clone);
    await inlineImageSources(clone);
    return clone;
}

export async function renderNodeToPngBlob(node) {
    const width = Number.parseInt(node.style.width, 10) || node.offsetWidth || 2050;
    const height = Number.parseInt(node.style.height, 10) || node.offsetHeight || 1153;
    await document.fonts?.ready;
    await waitForImages(node);
    const blob = await htmlToImageBlob(node, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,
        backgroundColor: '#ffffff',
        cacheBust: true
    });
    if (!blob) throw new Error('Certificate PNG export failed.');
    return blob;
}

async function renderNodeToPngBlobWithNativeCanvas(node) {
    const width = Number.parseInt(node.style.width, 10) || node.offsetWidth || 2050;
    const height = Number.parseInt(node.style.height, 10) || node.offsetHeight || 1153;
    const clone = await cloneForCanvas(node);
    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <foreignObject width="100%" height="100%">${serialized}</foreignObject>
        </svg>
    `;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const imageUrl = URL.createObjectURL(svgBlob);
    try {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Certificate render failed.'));
            image.src = imageUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        return await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Certificate PNG export failed.'));
            }, 'image/png');
        });
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

export async function downloadCertificatePng(node, filename) {
    const blob = await renderNodeToPngBlob(node);
    downloadBlob(blob, filename);
    return blob;
}

function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) {
        crc ^= bytes[i];
        for (let j = 0; j < 8; j += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ -1) >>> 0;
}

function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
    view.setUint32(offset, value, true);
}

function encodeString(value) {
    return new TextEncoder().encode(value);
}

function concatUint8(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
        output.set(part, offset);
        offset += part.length;
    });
    return output;
}

async function blobToBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

export async function downloadCertificateZip(files = [], filename = 'certificates.zip') {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = encodeString(file.name);
        const bytes = await blobToBytes(file.blob);
        const crc = crc32(bytes);

        const localHeader = new Uint8Array(30);
        const localView = new DataView(localHeader.buffer);
        writeUint32(localView, 0, 0x04034b50);
        writeUint16(localView, 4, 20);
        writeUint16(localView, 6, 0);
        writeUint16(localView, 8, 0);
        writeUint16(localView, 10, 0);
        writeUint16(localView, 12, 0);
        writeUint32(localView, 14, crc);
        writeUint32(localView, 18, bytes.length);
        writeUint32(localView, 22, bytes.length);
        writeUint16(localView, 26, nameBytes.length);
        writeUint16(localView, 28, 0);
        localParts.push(localHeader, nameBytes, bytes);

        const centralHeader = new Uint8Array(46);
        const centralView = new DataView(centralHeader.buffer);
        writeUint32(centralView, 0, 0x02014b50);
        writeUint16(centralView, 4, 20);
        writeUint16(centralView, 6, 20);
        writeUint16(centralView, 8, 0);
        writeUint16(centralView, 10, 0);
        writeUint16(centralView, 12, 0);
        writeUint16(centralView, 14, 0);
        writeUint32(centralView, 16, crc);
        writeUint32(centralView, 20, bytes.length);
        writeUint32(centralView, 24, bytes.length);
        writeUint16(centralView, 28, nameBytes.length);
        writeUint16(centralView, 30, 0);
        writeUint16(centralView, 32, 0);
        writeUint16(centralView, 34, 0);
        writeUint16(centralView, 36, 0);
        writeUint32(centralView, 38, 0);
        writeUint32(centralView, 42, offset);
        centralParts.push(centralHeader, nameBytes);

        offset += localHeader.length + nameBytes.length + bytes.length;
    }

    const centralDirectory = concatUint8(centralParts);
    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralDirectory.length);
    writeUint32(endView, 16, offset);
    writeUint16(endView, 20, 0);

    const zip = new Blob([concatUint8(localParts), centralDirectory, endHeader], { type: 'application/zip' });
    downloadBlob(zip, filename);
    return zip;
}

export async function printCertificateBlobs(blobs = []) {
    const printRoot = document.getElementById('cert-print-root') || document.createElement('div');
    printRoot.id = 'cert-print-root';
    printRoot.innerHTML = '';
    const urls = [];

    try {
        await Promise.all(blobs.map(async (blob) => {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            const sheet = document.createElement('div');
            sheet.className = 'cert-print-sheet';
            const image = document.createElement('img');
            image.className = 'cert-print-image';
            image.alt = 'Certificate';
            image.src = url;
            sheet.appendChild(image);
            printRoot.appendChild(sheet);
            if (!image.complete) {
                await new Promise((resolve, reject) => {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', () => reject(new Error('Certificate print image failed to load.')), { once: true });
                });
            }
        }));

        if (!printRoot.parentElement) document.body.appendChild(printRoot);
        document.body.classList.add('cert-printing');
        window.print();
    } finally {
        cleanupAfterPrint(() => {
            document.body.classList.remove('cert-printing');
            printRoot.innerHTML = '';
            urls.forEach((url) => URL.revokeObjectURL(url));
        });
    }
}

export async function printCertificates(nodes = []) {
    const printRoot = document.getElementById('cert-print-root') || document.createElement('div');
    printRoot.id = 'cert-print-root';
    printRoot.innerHTML = '';
    nodes.forEach((node) => {
        const sheet = document.createElement('div');
        sheet.className = 'cert-print-sheet';
        const frame = document.createElement('div');
        frame.className = 'cert-print-dom-frame';
        frame.appendChild(node.cloneNode(true));
        sheet.appendChild(frame);
        printRoot.appendChild(sheet);
    });
    if (!printRoot.parentElement) document.body.appendChild(printRoot);
    document.body.classList.add('cert-printing');
    await document.fonts?.ready;
    await waitForImages(printRoot);
    window.print();
    cleanupAfterPrint(() => {
        document.body.classList.remove('cert-printing');
        printRoot.innerHTML = '';
    });
}
