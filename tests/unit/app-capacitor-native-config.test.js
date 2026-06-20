import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
    return readFileSync(path, 'utf8');
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

        expect(rootPackage.dependencies['@capacitor/splash-screen']).toBeTruthy();
        expect(rootPackage.dependencies['@capacitor/status-bar']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/splash-screen']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/status-bar']).toBeTruthy();
        expect(rootPackageLock).toContain('"node_modules/@capacitor/splash-screen"');
        expect(rootPackageLock).toContain('"node_modules/@capacitor/status-bar"');
        expect(appPackageLock).toContain('"node_modules/@capacitor/splash-screen"');
        expect(appPackageLock).toContain('"node_modules/@capacitor/status-bar"');

        expect(config.plugins.SplashScreen).toMatchObject({
            launchAutoHide: false,
            backgroundColor: '#f6f8fb',
            showSpinner: false
        });
        expect(config.plugins.StatusBar).toMatchObject({
            style: 'DARK',
            backgroundColor: '#ffffff',
            overlaysWebView: false
        });

        expect(androidSettings).toContain("include ':capacitor-splash-screen'");
        expect(androidSettings).toContain("include ':capacitor-status-bar'");
        expect(androidBuild).toContain("implementation project(':capacitor-splash-screen')");
        expect(androidBuild).toContain("implementation project(':capacitor-status-bar')");
        expect(iosPackage).toContain('CapacitorSplashScreen');
        expect(iosPackage).toContain('CapacitorStatusBar');
    });

    it('wires first paint splash hiding and status bar setup into the app bootstrap', () => {
        const main = readProjectFile('apps/app/src/main.tsx');
        const nativeAppearance = readProjectFile('apps/app/src/lib/nativeAppearance.ts');

        expect(main).toContain('initializeNativeAppearance');
        expect(main).toContain('hideNativeSplashScreen');
        expect(nativeAppearance).toContain("import('@capacitor/status-bar')");
        expect(nativeAppearance).toContain("import('@capacitor/splash-screen')");
        expect(nativeAppearance).toContain('StatusBar.setOverlaysWebView({ overlay: false })');
        expect(nativeAppearance).toContain('SplashScreen.hide({ fadeOutDuration: 150 })');
    });

    it('keeps safe-area CSS and native deep-link declarations in place', () => {
        const appCss = readProjectFile('apps/app/src/styles/index.css');
        const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
        const iosInfo = readProjectFile('ios/App/App/Info.plist');
        const iosEntitlements = readProjectFile('ios/App/App/App.entitlements');

        expect(appCss).toContain('env(safe-area-inset-top)');
        expect(appCss).toContain('env(safe-area-inset-bottom)');
        expect(androidManifest).toContain('android:autoVerify="true"');
        expect(androidManifest).toContain('android:host="allplays.ai"');
        expect(androidManifest).toContain('android:pathPrefix="/app"');
        expect(androidManifest).toContain('android:scheme="allplays"');
        expect(iosInfo).toContain('<string>allplays</string>');
        expect(iosInfo).toContain('<string>ai.allplays.lite</string>');
        expect(iosEntitlements).toContain('com.apple.developer.associated-domains');
        expect(iosEntitlements).toContain('applinks:allplays.ai');
    });
});
