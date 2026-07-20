export default {
    testDir: './tests/smoke',
    testMatch: ['**/*.spec.js'],
    snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
    timeout: 30000,
    retries: process.env.CI ? 1 : 0,
    expect: {
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixels: 500,
            scale: 'css'
        }
    },
    use: {
        browserName: 'chromium',
        headless: true,
        baseURL: process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173',
        colorScheme: 'light',
        deviceScaleFactor: 1,
        locale: 'en-US',
        reducedMotion: 'reduce',
        timezoneId: 'UTC',
        viewport: { width: 1280, height: 720 }
    }
};
