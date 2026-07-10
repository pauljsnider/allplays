import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
    return readFileSync(path, 'utf8');
}

function readPlistStringValue(plist, key) {
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
    return plist.match(pattern)?.[1] || '';
}

describe('Capacitor native config', () => {
    it('declares splash screen and status bar plugins in app and native manifests', () => {
        const config = JSON.parse(readProjectFile('capacitor.config.json'));
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const rootPackageLock = readProjectFile('package-lock.json');
        const appPackageLock = readProjectFile('apps/app/package-lock.json');
        const androidSettings = readProjectFile('android/capacitor.settings.gradle');
        const androidBuild = readProjectFile('android/app/capacitor.build.gradle');
        const iosPackage = readProjectFile('ios/App/CapApp-SPM/Package.swift');

        expect(rootPackage.dependencies['@capacitor/keyboard']).toBeTruthy();
        expect(rootPackage.dependencies['@capacitor/splash-screen']).toBeTruthy();
        expect(rootPackage.dependencies['@capacitor/status-bar']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/keyboard']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/splash-screen']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/status-bar']).toBeTruthy();
        expect(rootPackageLock).toContain('"node_modules/@capacitor/keyboard"');
        expect(rootPackageLock).toContain('"node_modules/@capacitor/splash-screen"');
        expect(rootPackageLock).toContain('"node_modules/@capacitor/status-bar"');
        expect(appPackageLock).toContain('"node_modules/@capacitor/keyboard"');
        expect(appPackageLock).toContain('"node_modules/@capacitor/splash-screen"');
        expect(appPackageLock).toContain('"node_modules/@capacitor/status-bar"');

        expect(config.plugins.SplashScreen).toMatchObject({
            launchAutoHide: false,
            backgroundColor: '#f6f8fb',
            showSpinner: false
        });
        expect(config.plugins.StatusBar).toMatchObject({
            style: 'LIGHT',
            backgroundColor: '#ffffff',
            overlaysWebView: false
        });
        expect(config.plugins.Keyboard).toMatchObject({
            resize: 'native',
            resizeOnFullScreen: true
        });

        expect(androidSettings).toContain("include ':capacitor-keyboard'");
        expect(androidSettings).toContain("include ':capacitor-splash-screen'");
        expect(androidSettings).toContain("include ':capacitor-status-bar'");
        expect(androidBuild).toContain("implementation project(':capacitor-keyboard')");
        expect(androidBuild).toContain("implementation project(':capacitor-splash-screen')");
        expect(androidBuild).toContain("implementation project(':capacitor-status-bar')");
        expect(iosPackage).toContain('CapacitorKeyboard');
        expect(iosPackage).toContain('CapacitorSplashScreen');
        expect(iosPackage).toContain('CapacitorStatusBar');
    });

    it('pins the app Vite dependency version in both lockfiles', () => {
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = readProjectFile('apps/app/pnpm-lock.yaml');

        expect(appPackage.devDependencies.vite).toBe('^8.1.3');
        expect(appPackageLock.packages[''].devDependencies.vite).toBe('^8.1.3');
        expect(appPackageLock.packages['node_modules/vite'].version).toBe('8.1.3');
        expect(appPnpmLock).toContain('vite@8.1.3:');
        const pluginReactVersion = appPackage.devDependencies['@vitejs/plugin-react'].replace(/^\^/, '');
        expect(appPackageLock.packages['node_modules/@vitejs/plugin-react'].version).toBe(pluginReactVersion);
        expect(appPnpmLock).toContain(`'@vitejs/plugin-react@${pluginReactVersion}(vite@8.1.3`);
    });

    it('keeps shared Camera and Firebase maintenance versions aligned across manifests and lockfiles', () => {
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = readProjectFile('apps/app/pnpm-lock.yaml');
        const expectedDependencies = {
            '@capacitor/camera': { specifier: '^8.2.1', version: '8.2.1' },
            firebase: { specifier: '12.16.0', version: '12.16.0' }
        };

        Object.entries(expectedDependencies).forEach(([dependency, expected]) => {
            expect(rootPackage.dependencies[dependency]).toBe(expected.specifier);
            expect(appPackage.dependencies[dependency]).toBe(expected.specifier);
            expect(rootPackageLock.packages[''].dependencies[dependency]).toBe(expected.specifier);
            expect(appPackageLock.packages[''].dependencies[dependency]).toBe(expected.specifier);
            expect(rootPackageLock.packages[`node_modules/${dependency}`].version).toBe(expected.version);
            expect(appPackageLock.packages[`node_modules/${dependency}`].version).toBe(expected.version);
        });

        expect(appPnpmLock).toContain("'@capacitor/camera@8.2.1':");
        expect(appPnpmLock).toContain('firebase@12.16.0:');
        expect(appPnpmLock).not.toContain('firebase@12.15.0:');
    });

    it('wires first paint splash hiding and status bar setup into the app bootstrap', () => {
        const main = readProjectFile('apps/app/src/main.tsx');
        const nativeAppearance = readProjectFile('apps/app/src/lib/nativeAppearance.ts');

        expect(main).toContain('initializeNativeAppearance');
        expect(main).toContain('hideNativeSplashScreen');
        expect(nativeAppearance).toContain("import('@capacitor/status-bar')");
        expect(nativeAppearance).toContain("import('@capacitor/splash-screen')");
        expect(nativeAppearance).toContain('StatusBar.setOverlaysWebView({ overlay: false })');
        expect(nativeAppearance).toContain('StatusBar.setStyle({ style: Style.Light })');
        expect(nativeAppearance).toContain('StatusBar.setBackgroundColor({ color: \'#ffffff\' })');
        expect(nativeAppearance).toContain('SplashScreen.hide({ fadeOutDuration: 150 })');
    });

    it('keeps safe-area CSS and native deep-link declarations in place', () => {
        const appCss = readProjectFile('apps/app/src/styles/index.css');
        const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
        const iosInfo = readProjectFile('ios/App/App/Info.plist');
        const iosEntitlements = readProjectFile('ios/App/App/App.entitlements');

        expect(appCss).toContain('env(safe-area-inset-top)');
        expect(appCss).toContain('env(safe-area-inset-bottom)');
        expect(appCss).toContain('--app-search-keyboard-inset');
        expect(androidManifest).toContain('android:autoVerify="true"');
        expect(androidManifest).toContain('android:host="allplays.ai"');
        expect(androidManifest).toContain('android:pathPrefix="/app"');
        expect(androidManifest).toContain('android:scheme="allplays"');
        expect(androidManifest).toContain('android:windowSoftInputMode="adjustResize"');
        expect(iosInfo).toContain('<string>allplays</string>');
        expect(iosInfo).toContain('<string>ai.allplays.lite</string>');
        expect(iosEntitlements).toContain('com.apple.developer.associated-domains');
        expect(iosEntitlements).toContain('applinks:allplays.ai');
    });

    it('disables Android backup so the persisted Firebase session cannot be exfiltrated via adb backup (#3417)', () => {
        const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
        const extractionRules = readProjectFile('android/app/src/main/res/xml/data_extraction_rules.xml');

        // The WebView stores a Firebase refresh/ID token in localStorage, so no app
        // data may be captured by backup or device transfer.
        expect(androidManifest).toContain('android:allowBackup="false"');
        expect(androidManifest).not.toContain('android:allowBackup="true"');
        expect(androidManifest).toContain('android:fullBackupContent="false"');
        expect(androidManifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');

        expect(extractionRules).toContain('<cloud-backup>');
        expect(extractionRules).toContain('<device-transfer>');
        expect(extractionRules).toContain('<exclude domain="root" />');
        expect(extractionRules).toContain('<exclude domain="database" />');
        expect(extractionRules).toContain('<exclude domain="sharedpref" />');
    });

    it('describes shared iOS camera and photo access for profile images and statsheet capture', () => {
        const iosInfo = readProjectFile('ios/App/App/Info.plist');
        const cameraDescription = readPlistStringValue(iosInfo, 'NSCameraUsageDescription').toLowerCase();
        const photoDescription = readPlistStringValue(iosInfo, 'NSPhotoLibraryUsageDescription').toLowerCase();

        expect(cameraDescription).toContain('profile');
        expect(cameraDescription).toContain('stat sheet');
        expect(cameraDescription).toContain('game-day');
        expect(photoDescription).toContain('profile');
        expect(photoDescription).toContain('stat sheet');
        expect(photoDescription).toContain('game-day');
    });
});
