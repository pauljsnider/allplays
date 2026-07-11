import { test, expect } from '@playwright/test';

async function stubCertificateBrowserApis(page) {
    await page.addInitScript(() => {
        window.__certificatePrintCalls = 0;
        window.__certificatePrintSheetCount = 0;
        window.__certificatePrintImageCount = 0;
        window.__sharedLinks = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text) => {
                    window.__sharedLinks.push(text);
                }
            }
        });
        window.print = () => {
            window.__certificatePrintCalls += 1;
            window.__certificatePrintSheetCount = document.querySelectorAll('#cert-print-root .cert-print-sheet').length;
            window.__certificatePrintImageCount = document.querySelectorAll('#cert-print-root .cert-print-image').length;
        };
    });
}

test('certificates demo workflow creates, edits, exports, and prints', async ({ page, baseURL }) => {
    await stubCertificateBrowserApis(page);

    await page.goto(`${baseURL}/certificates.html?demo=1#teamId=demo-junior-current`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Awards & Certificates' })).toBeVisible();
    await expect(page.locator('#cert-new-run-btn')).toHaveText('Start new run');
    await expect(page.locator('#cert-view-saved-btn')).toHaveText('View saved work');
    await expect(page.locator('#cert-custom-recipient-btn')).toHaveText('Create one-off certificate');
    await expect(page.locator('#cert-setup #cert-generate-btn')).toHaveCount(0);
    await expect(page.locator('#cert-saved-work')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();
    await expect(page.locator('#cert-player-selection #cert-generate-btn')).toBeVisible();
    await expect(page.locator('#cert-player-selection #cert-generate-btn')).toHaveText('Create drafts for selected players');
    await expect(page.locator('#cert-advanced-customization')).not.toHaveAttribute('open', '');
    await expect(page.locator('#cert-font-recipient')).not.toBeVisible();
    await expect(page.locator('#cert-preview .cert-canvas')).toHaveAttribute('data-template-id', 'banner');
    await expect(page.locator('#cert-frame-purchase-link')).toBeVisible();
    await page.locator('#cert-frame-purchase-link').fill('https://frames.example.test/junior-current');

    await page.getByText('Customize certificate design').click();
    await expect(page.locator('#cert-advanced-customization')).toHaveAttribute('open', '');
    await expect(page.locator('[data-template-id]')).toHaveCount(3);
    await expect(page.locator('input[name="cert-color-mode"]')).toHaveCount(3);
    await expect(page.locator('#foregroundImageRef-source')).toBeVisible();
    await expect(page.locator('#backgroundImageRef-source')).toBeVisible();
    await expect(page.locator('#watermarkImageRef-source')).toBeVisible();
    await expect(page.locator('#cert-font-recipient')).toBeVisible();
    await expect(page.locator('#cert-add-signer-btn')).toBeVisible();
    await expect(page.locator('#cert-save-default-btn')).toHaveText('Save setup for future runs');
    await expect(page.locator('#cert-reset-defaults-btn')).toHaveText('Reset setup');

    await page.locator('#cert-view-saved-btn').click();
    await expect(page.locator('#cert-review-layout')).toBeVisible();
    await expect(page.locator('#cert-review-grid')).toContainText('No saved work yet.');
    await page.locator('#cert-new-run-btn').click();
    await expect(page.locator('#cert-setup-layout')).toBeVisible();

    await page.locator('#cert-font-recipient').selectOption('athletic');
    await expect(page.locator('#cert-preview .cert-recipient-name')).toHaveCSS('font-family', /Impact/);
    await page.locator('#cert-font-recipient').selectOption('classic');

    const dimensions = await page.locator('#cert-preview .cert-canvas').evaluate((node) => ({
        width: node.style.width,
        height: node.style.height,
        text: node.innerText
    }));
    expect(dimensions).toMatchObject({ width: '2050px', height: '1153px' });
    expect(dimensions.text).toContain('Junior Current');
    expect(dimensions.text).toContain('VIVIAN KARPUK');

    await expect(page.locator('#cert-preview .cert-crest-image')).toHaveCount(1);
    await page.locator('#foregroundImageRef-source').selectOption('');
    await expect(page.locator('#cert-preview .cert-crest-image')).toHaveCount(0);
    await expect(page.locator('#cert-preview .cert-crest-placeholder')).toHaveCount(0);
    await page.locator('#foregroundImageRef-source').selectOption('team-logo');
    await expect(page.locator('#cert-preview .cert-crest-image')).toHaveCount(1);

    await page.locator('#backgroundImageRef-source').selectOption('team-logo');
    await expect(page.locator('#cert-preview .cert-background-image')).toHaveCount(1);
    await expect(page.locator('#cert-preview img.cert-background-image')).toHaveCount(1);
    await page.locator('#backgroundImageRef-source').selectOption('');
    await expect(page.locator('#cert-preview .cert-background-image')).toHaveCount(0);
    await expect(page.locator('#backgroundImageRef-source optgroup[label="Previous uploads"] option')).toHaveCount(1);
    await page.locator('#backgroundImageRef-source').selectOption('img/logo_small.png');
    await expect(page.locator('#cert-preview .cert-background-image')).toHaveCount(1);
    await page.locator('#backgroundImageRef-source').selectOption('');
    await expect(page.locator('#cert-preview .cert-background-image')).toHaveCount(0);
    await page.locator('#backgroundImageRef-source').selectOption('team-logo');
    await page.locator('#cert-background-opacity').evaluate((input) => {
        input.value = '35';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#cert-preview .cert-background-image')).toHaveCSS('opacity', '0.35');

    await expect(page.locator('#cert-preview .cert-watermark-image')).toHaveCount(1);
    await page.locator('#watermarkImageRef-source').selectOption('');
    await expect(page.locator('#cert-preview .cert-watermark-image')).toHaveCount(0);
    await page.locator('#watermarkImageRef-source').selectOption('team-logo');
    await expect(page.locator('#cert-preview .cert-watermark-image')).toHaveCount(1);

    await page.locator('#cert-add-signer-btn').click();
    await page.locator('[data-signer-field="name"]').last().fill('Fourth Coach');
    await page.locator('[data-signer-field="role"]').last().fill('Coach');
    await expect(page.locator('#cert-preview .cert-canvas')).toContainText('Fourth Coach');

    await page.locator('#cert-generate-btn').click();
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(12);
    await expect(page.locator('#cert-description-progress')).toContainText(/Generating descriptions|Descriptions ready/);
    await expect(page.locator('#cert-save-drafts-btn')).toHaveText('Save progress');
    await expect(page.locator('#cert-publish-btn')).toHaveText('Publish certificates');
    await expect(page.locator('#cert-review-frame-purchase-link')).toHaveValue('https://frames.example.test/junior-current');
    await page.locator('#cert-review-frame-purchase-link').fill('https://frames.example.test/junior-current/reviewed');
    await expect(page.locator('#cert-review-preview .cert-canvas')).toContainText('Fall 2025');
    await expect(page.locator('[data-draft-field="description"]').first()).toHaveJSProperty('maxLength', 350);
    await expect.poll(() => page.locator('[data-draft-field="description"]').first().inputValue().then((value) => value.length)).toBeLessThanOrEqual(350);

    const firstName = page.locator('[data-draft-field="recipientName"]').first();
    await firstName.fill('Vivian Karpuk Jr.');
    await expect(page.locator('#cert-review-preview .cert-recipient-name')).toContainText('Vivian Karpuk Jr.');
    await expect(page.locator('#cert-review-frame-purchase-link')).toHaveValue('https://frames.example.test/junior-current/reviewed');
    await expect(page.locator('#cert-review-preview .cert-recipient-name')).toHaveCSS('text-transform', 'uppercase');

    await page.locator('#cert-regenerate-selected-btn').click();
    await expect.poll(() => page.locator('[data-draft-field="description"]').first().inputValue().then((value) => value.length)).toBeLessThanOrEqual(350);

    await page.locator('[data-regenerate-draft]').first().click();
    await expect(page.locator('[data-draft-row]').first().locator('.cert-status')).toContainText(/Ready|Review/);

    await page.locator('#cert-save-drafts-btn').click();
    await expect(page.locator('#cert-alert')).toContainText('Demo drafts saved for this session.');
    await expect(page.locator('[data-open-batch]')).toHaveCount(1);
    await expect(page.locator('[data-open-certificate]')).toHaveCount(6);
    await expect(page.locator('[data-toggle-saved-list="sidebar-certificates"]')).toContainText('Show all 12');
    await expect(page.locator('#cert-sidebar')).toContainText('Showing 6 of 12');
    await page.locator('[data-toggle-saved-list="sidebar-certificates"]').click();
    await expect(page.locator('[data-toggle-saved-list="sidebar-certificates"]')).toContainText('Show fewer');
    await expect(page.locator('[data-open-certificate]')).toHaveCount(12);
    await expect(page.locator('#cert-sidebar')).toContainText(/Today|Yesterday|days ago/);

    await page.locator('[data-share-certificate]').filter({ hasText: 'Share certificate' }).first().click();
    await expect(page.locator('#cert-alert')).toContainText('Share link copied');
    await expect.poll(() => page.evaluate(() => window.__sharedLinks.at(-1) || '')).toContain('certificateId=');

    await page.locator('[data-share-batch]').first().click();
    await expect(page.locator('#cert-alert')).toContainText('Share link copied');
    await expect.poll(() => page.evaluate(() => window.__sharedLinks.at(-1) || '')).toContain('batchId=');

    await page.locator('[data-open-certificate]').filter({ hasText: 'Vivian Karpuk Jr.' }).click();
    await expect(page.locator('#cert-alert')).toContainText('Saved certificate opened for editing');
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(1);
    await expect(page.locator('#cert-review-preview .cert-recipient-name')).toContainText('Vivian Karpuk Jr.');
    await expect(page.locator('#cert-review-frame-purchase-link')).toHaveValue('https://frames.example.test/junior-current/reviewed');

    await page.locator('[data-open-batch]').first().click();
    await expect(page.locator('#cert-alert')).toContainText('Saved run opened for editing');
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(12);

    await page.locator('#cert-new-run-btn').click();
    await expect(page.locator('#cert-setup-layout')).toBeVisible();
    await page.locator('#cert-view-saved-btn').click();
    await expect(page.locator('#cert-review-layout')).toBeVisible();
    await expect(page.locator('#cert-sidebar [data-open-batch]')).toHaveCount(1);
    await expect(page.locator('#cert-sidebar [data-open-certificate]')).toHaveCount(12);
    await expect(page.locator('[data-toggle-saved-list="landing-certificates"]')).toContainText('Show all 12');
    await page.locator('[data-toggle-saved-list="landing-certificates"]').click();
    await expect(page.locator('[data-toggle-saved-list="landing-certificates"]')).toContainText('Show fewer');

    await page.locator('#cert-sidebar [data-open-certificate]').filter({ hasText: 'Vivian Karpuk Jr.' }).click();
    await expect(page.locator('#cert-alert')).toContainText('Saved certificate opened for editing');
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(1);

    await page.locator('#cert-new-run-btn').click();
    await page.locator('#cert-view-saved-btn').click();
    await page.locator('#cert-sidebar [data-open-batch]').first().click();
    await expect(page.locator('#cert-alert')).toContainText('Saved run opened for editing');
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(12);

    for (let index = 3; index < 12; index += 1) {
        await page.locator('[data-draft-field="includeInExport"]').nth(index).uncheck();
    }

    await page.locator('#cert-publish-btn').click();
    await expect(page.locator('#cert-alert')).toContainText('Demo certificates published for this session.');

    await page.locator('#cert-print-btn').click();
    await expect.poll(() => page.evaluate(() => window.__certificatePrintCalls)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__certificatePrintSheetCount)).toBe(3);
    await expect.poll(() => page.evaluate(() => window.__certificatePrintImageCount)).toBe(3);

    const [rowDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('[data-download-draft]').first().click()
    ]);
    expect(rowDownload.suggestedFilename()).toContain('vivian-karpuk-jr');

    const [previewDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#cert-preview-png-btn').click()
    ]);
    expect(previewDownload.suggestedFilename()).toContain('vivian-karpuk-jr');

    const pngDownloads = [];
    const onDownload = (download) => pngDownloads.push(download);
    page.on('download', onDownload);
    await page.locator('#cert-png-btn').click();
    await expect.poll(() => pngDownloads.length).toBe(3);
    page.off('download', onDownload);
    expect(pngDownloads.map((download) => download.suggestedFilename()).join('\n')).toContain('vivian-karpuk-jr');

    const [zipDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#cert-zip-btn').click()
    ]);
    expect(zipDownload.suggestedFilename()).toBe('junior-current-certificates.zip');
});

test('one-off certificates save, reopen, export, and print with custom data intact', async ({ page, baseURL }) => {
    await stubCertificateBrowserApis(page);

    await page.goto(`${baseURL}/certificates.html?demo=1#teamId=demo-junior-current`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Awards & Certificates' })).toBeVisible();

    await page.locator('#cert-custom-recipient-btn').click();
    await expect(page.locator('#cert-review-grid tbody tr')).toHaveCount(1);

    await page.locator('[data-draft-field="recipientName"]').fill('Coach Choice');
    await page.locator('[data-draft-field="awardTitle"]').fill('Leadership Award');
    await page.locator('[data-draft-field="description"]').fill('Closed out the season with steady leadership.');
    await page.locator('[data-draft-field="includeInExport"]').uncheck();
    await expect(page.locator('[data-draft-field="includeInExport"]')).not.toBeChecked();
    await expect(page.locator('#cert-review-preview .cert-recipient-name')).toContainText('Coach Choice');

    await page.locator('#cert-save-drafts-btn').click();
    await expect(page.locator('#cert-alert')).toContainText('Demo drafts saved for this session.');
    await expect(page.locator('[data-open-batch]')).toHaveCount(1);
    await expect(page.locator('[data-open-certificate]')).toHaveCount(1);

    await page.locator('[data-open-certificate]').first().click();
    await expect(page.locator('#cert-alert')).toContainText('Saved certificate opened for editing');
    await expect(page.locator('[data-draft-field="recipientName"]')).toHaveValue('Coach Choice');
    await expect(page.locator('[data-draft-field="awardTitle"]')).toHaveValue('Leadership Award');
    await expect(page.locator('[data-draft-field="description"]')).toHaveValue('Closed out the season with steady leadership.');
    await expect(page.locator('[data-draft-field="includeInExport"]')).not.toBeChecked();

    await page.locator('[data-draft-field="includeInExport"]').check();
    await page.locator('#cert-save-drafts-btn').click();
    await expect(page.locator('#cert-alert')).toContainText('Demo drafts saved for this session.');

    await page.locator('[data-open-batch]').first().click();
    await expect(page.locator('#cert-alert')).toContainText('Saved run opened for editing');
    await expect(page.locator('[data-draft-field="recipientName"]')).toHaveValue('Coach Choice');
    await expect(page.locator('[data-draft-field="awardTitle"]')).toHaveValue('Leadership Award');
    await expect(page.locator('[data-draft-field="description"]')).toHaveValue('Closed out the season with steady leadership.');
    await expect(page.locator('[data-draft-field="includeInExport"]')).toBeChecked();

    const [pngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#cert-png-btn').click()
    ]);
    expect(pngDownload.suggestedFilename()).toContain('coach-choice');

    await page.locator('#cert-print-btn').click();
    await expect.poll(() => page.evaluate(() => window.__certificatePrintCalls)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__certificatePrintSheetCount)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__certificatePrintImageCount)).toBe(1);
    await expect(page.locator('#cert-review-preview .cert-recipient-name')).toContainText('Coach Choice');
});
