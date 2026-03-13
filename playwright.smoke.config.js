export default {
    testDir: './tests/smoke',
    testMatch: ['**/*.spec.js'],
    timeout: 30000,
    retries: 0,
    use: {
        browserName: 'chromium',
        headless: true,
        baseURL: process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173'
    }
};

