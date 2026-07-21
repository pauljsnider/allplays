const quarantinedAuthVisual = /@visual app auth screen exposes sign in, sign up, Google, activation code, invite, and reset flows/;

export default {
    testDir: './tests/smoke',
    testMatch: ['**/*.spec.js'],
    snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
    timeout: 30000,
    retries: 0,
    projects: [
        {
            // Targeted quarantine for the auth-join-code-signup.png flake; tracked by #4100.
            name: 'auth-profile-visual-quarantine',
            testMatch: ['**/app-auth-profile.spec.js'],
            grep: quarantinedAuthVisual,
            retries: process.env.CI ? 1 : 0
        },
        {
            name: 'smoke',
            grepInvert: quarantinedAuthVisual,
            retries: 0
        }
    ],
    expect: {
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixels: 0,
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
