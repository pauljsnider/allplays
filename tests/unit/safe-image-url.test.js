import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
    createSafeImageElement,
    resolveSafeDrillDiagramUrl,
    resolveSafeProfilePhotoUrl,
    resolveSafeProfilePhotoWriteUrl
} from '../../js/safe-image-url.js';

const firebaseDiagram = 'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/drills%2Fdiagram.png?alt=media&token=token-1';

describe('trusted persisted image URLs', () => {
    it('accepts expected Firebase and Google profile image hosts', () => {
        expect(resolveSafeDrillDiagramUrl(firebaseDiagram)).toBe(firebaseDiagram);
        expect(resolveSafeDrillDiagramUrl('https://storage.googleapis.com/allplays-images/drills/diagram.webp'))
            .toBe('https://storage.googleapis.com/allplays-images/drills/diagram.webp');
        expect(resolveSafeProfilePhotoUrl('https://lh3.googleusercontent.com/a/profile-photo'))
            .toBe('https://lh3.googleusercontent.com/a/profile-photo');
        [
            firebaseDiagram,
            'https://firebasestorage.googleapis.com/v0/b/game-flow-c6311.firebasestorage.app/o/profiles%2Fphoto.png?alt=media',
            'https://storage.googleapis.com/game-flow-img.firebasestorage.app/profiles/photo.png',
            'https://storage.googleapis.com/download/storage/v1/b/game-flow-c6311.firebasestorage.app/o/profiles%2Fphoto.png?alt=media',
            'https://game-flow-img.firebasestorage.app/profiles/photo.png'
        ].forEach((url) => expect(resolveSafeProfilePhotoWriteUrl(url)).toBe(url));
    });

    it('keeps legacy Firebase images renderable but restricts future profile-photo writes to first-party buckets', () => {
        const attackerOwnedBucket = 'https://firebasestorage.googleapis.com/v0/b/attacker-owned.firebasestorage.app/o/avatar.png?alt=media';
        expect(resolveSafeProfilePhotoUrl(attackerOwnedBucket)).toBe(attackerOwnedBucket);
        expect(resolveSafeDrillDiagramUrl(attackerOwnedBucket)).toBe(attackerOwnedBucket);
        expect(resolveSafeProfilePhotoWriteUrl(attackerOwnedBucket)).toBe('');
        expect(resolveSafeProfilePhotoWriteUrl('https://storage.googleapis.com/attacker-owned.firebasestorage.app/avatar.png')).toBe('');
        expect(resolveSafeProfilePhotoWriteUrl('https://attacker-owned.firebasestorage.app/avatar.png')).toBe('');
    });

    it.each([
        'javascript:alert(1)',
        'data:image/svg+xml,<svg onload=alert(1)>',
        'http://firebasestorage.googleapis.com/v0/b/bucket/o/photo.png',
        'https://firebasestorage.googleapis.com@attacker.example/photo.png',
        'https://attacker.example/photo.png',
        'https://firebasestorage.googleapis.com/photo.png" onerror="alert(1)',
        "https://firebasestorage.googleapis.com/photo.png' onerror='alert(1)",
        'https://firebasestorage.googleapis.com/photo.png&#39; onerror=alert(1)'
    ])('rejects unsafe or untrusted image URL %s', (payload) => {
        expect(resolveSafeDrillDiagramUrl(payload)).toBe('');
        expect(resolveSafeProfilePhotoUrl(payload)).toBe('');
        expect(resolveSafeProfilePhotoWriteUrl(payload)).toBe('');
    });

    it('constructs image attributes through the DOM without creating executable attributes', () => {
        const dom = new JSDOM('<!doctype html><body></body>');
        const documentRef = dom.window.document;
        const image = createSafeImageElement({
            documentRef,
            url: firebaseDiagram,
            resolveUrl: resolveSafeDrillDiagramUrl,
            alt: 'Diagram " onerror="globalThis.__xss = true',
            className: 'safe-diagram'
        });

        documentRef.body.appendChild(image);
        expect(image.hasAttribute('onerror')).toBe(false);
        expect(image.hasAttribute('onclick')).toBe(false);
        expect(image.getAttribute('src')).toBe(firebaseDiagram);
        expect(image.getAttribute('alt')).toBe('Diagram " onerror="globalThis.__xss = true');
        expect(dom.window.__xss).toBeUndefined();
    });

    it('returns no element for javascript, data, quote, or onerror payloads', () => {
        const dom = new JSDOM('<!doctype html><body></body>');
        const payloads = [
            'javascript:globalThis.__xss = true',
            'data:image/svg+xml,<svg onload=globalThis.__xss=true>',
            'https://firebasestorage.googleapis.com/x" onerror="globalThis.__xss=true'
        ];

        payloads.forEach((url) => {
            expect(createSafeImageElement({
                documentRef: dom.window.document,
                url,
                resolveUrl: resolveSafeDrillDiagramUrl
            })).toBeNull();
        });
        expect(dom.window.document.querySelectorAll('[onerror], [onclick]')).toHaveLength(0);
        expect(dom.window.__xss).toBeUndefined();
    });

    it('treats HTML entities as inert URL text rather than markup', () => {
        const dom = new JSDOM('<!doctype html><body></body>');
        const image = createSafeImageElement({
            documentRef: dom.window.document,
            url: 'https://firebasestorage.googleapis.com/x&quot;onerror=globalThis.__xss=true',
            resolveUrl: resolveSafeDrillDiagramUrl
        });
        dom.window.document.body.appendChild(image);

        expect(image.hasAttribute('onerror')).toBe(false);
        expect(image.hasAttribute('onclick')).toBe(false);
        expect(image.src).toContain('&quot;onerror=globalThis.__xss=true');
        expect(dom.window.__xss).toBeUndefined();
    });

    it('uses a listener-only load-error fallback without an onerror attribute', () => {
        const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>');
        const documentRef = dom.window.document;
        const fallback = documentRef.createElement('div');
        fallback.textContent = 'F';
        const onLoadError = vi.fn((image) => image.replaceWith(fallback));
        const image = createSafeImageElement({
            documentRef,
            url: firebaseDiagram,
            resolveUrl: resolveSafeDrillDiagramUrl,
            onLoadError
        });
        documentRef.getElementById('root').appendChild(image);

        expect(image.hasAttribute('onerror')).toBe(false);
        image.dispatchEvent(new dom.window.Event('error'));
        expect(onLoadError).toHaveBeenCalledOnce();
        expect(documentRef.getElementById('root').textContent).toBe('F');
    });
});
