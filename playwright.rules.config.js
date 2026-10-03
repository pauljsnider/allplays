// Separate from mocked smoke: absence of an emulator is a failure, never a skip.
export default {
    testDir: './tests/integration',
    testMatch: 'classic-tracker-rules.spec.js',
    workers: 1,
    timeout: 45000,
    retries: 0,
    use: { browserName: 'chromium', headless: true, baseURL: 'http://127.0.0.1:4177' },
    webServer: {
        command: 'python3 -m http.server 4177 --bind 127.0.0.1',
        url: 'http://127.0.0.1:4177',
        reuseExistingServer: false
    }
};
