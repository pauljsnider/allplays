import { expect, test } from '@playwright/test';

test('persisted image URL helper stays inert in a real browser DOM', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/login.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
        const {
            createSafeImageElement,
            resolveSafeDrillDiagramUrl
        } = await import('/js/safe-image-url.js?v=1');
        const root = document.createElement('div');
        document.body.appendChild(root);
        window.__storedImageXss = false;

        const safeUrl = 'https://firebasestorage.googleapis.com/v0/b/test/o/diagram.png?alt=media';
        const entityUrl = 'https://firebasestorage.googleapis.com/x&quot;onerror=window.__storedImageXss=true';
        const safeImage = createSafeImageElement({
            url: safeUrl,
            resolveUrl: resolveSafeDrillDiagramUrl,
            alt: 'Diagram " onerror="window.__storedImageXss=true'
        });
        const entityImage = createSafeImageElement({
            url: entityUrl,
            resolveUrl: resolveSafeDrillDiagramUrl
        });
        root.append(safeImage, entityImage);

        const rejected = [
            'javascript:window.__storedImageXss=true',
            'data:image/svg+xml,<svg onload=window.__storedImageXss=true>',
            'https://firebasestorage.googleapis.com/x" onerror="window.__storedImageXss=true'
        ].map((url) => createSafeImageElement({
            url,
            resolveUrl: resolveSafeDrillDiagramUrl
        }));

        return {
            fired: window.__storedImageXss,
            injectedHandlerCount: root.querySelectorAll('[onerror], [onclick]').length,
            safeAlt: safeImage.getAttribute('alt'),
            entitySrc: entityImage.getAttribute('src'),
            rejectedAll: rejected.every((image) => image === null)
        };
    });

    expect(result).toEqual({
        fired: false,
        injectedHandlerCount: 0,
        safeAlt: 'Diagram " onerror="window.__storedImageXss=true',
        entitySrc: 'https://firebasestorage.googleapis.com/x&quot;onerror=window.__storedImageXss=true',
        rejectedAll: true
    });
});
