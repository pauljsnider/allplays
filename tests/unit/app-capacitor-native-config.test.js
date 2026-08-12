import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

function readProjectFile(path) {
    return readFileSync(path, 'utf8');
}

function readPlistStringValue(plist, key) {
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
    return plist.match(pattern)?.[1] || '';
}

describe('Capacitor native config', () => {
    it('keeps Capacitor runtime and camera versions aligned across JavaScript manifests and lockfiles', () => {
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLockSource = readProjectFile('apps/app/pnpm-lock.yaml');
        const appPnpmLock = parseYaml(appPnpmLockSource);

        const rootRuntimePackages = ['@capacitor/cli', '@capacitor/android', '@capacitor/core', '@capacitor/ios'];
        rootRuntimePackages.forEach((dependency) => {
            const dependencyGroup = dependency === '@capacitor/cli' ? 'devDependencies' : 'dependencies';
            expect(rootPackage[dependencyGroup][dependency]).toBe('^8.5.0');
            expect(rootPackageLock.packages[''][dependencyGroup][dependency]).toBe('^8.5.0');
            expect(rootPackageLock.packages[`node_modules/${dependency}`].version).toBe('8.5.0');
        });

        expect(rootPackage.dependencies['@capacitor/camera']).toBe('^8.2.2');
        expect(rootPackageLock.packages[''].dependencies['@capacitor/camera']).toBe('^8.2.2');
        expect(rootPackageLock.packages['node_modules/@capacitor/camera'].version).toBe('8.2.2');

        expect(appPackage.dependencies['@capacitor/core']).toBe('^8.5.0');
        expect(appPackage.dependencies['@capacitor/camera']).toBe('^8.2.2');
        expect(appPackageLock.packages[''].dependencies['@capacitor/core']).toBe('^8.5.0');
        expect(appPackageLock.packages[''].dependencies['@capacitor/camera']).toBe('^8.2.2');
        expect(appPackageLock.packages['node_modules/@capacitor/core'].version).toBe('8.5.0');
        expect(appPackageLock.packages['node_modules/@capacitor/camera'].version).toBe('8.2.2');

        expect(appPnpmLock.importers['.'].dependencies['@capacitor/core'].specifier).toBe('^8.5.0');
        expect(appPnpmLock.importers['.'].dependencies['@capacitor/camera'].specifier).toBe('^8.2.2');
        expect(appPnpmLock.packages['@capacitor/core@8.5.0']).toBeDefined();
        expect(appPnpmLock.packages['@capacitor/camera@8.2.2']).toBeDefined();
        expect(appPnpmLockSource).not.toMatch(/@capacitor\/core(?:@|': )8\.4\.2/);
    });

    it('keeps the synchronized iOS SwiftPM runtime aligned with the JavaScript lockfile', () => {
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const iosPackage = readProjectFile('ios/App/CapApp-SPM/Package.swift');
        const iosPackageResolvedSource = readProjectFile(
            'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'
        );
        const iosPackageResolved = JSON.parse(iosPackageResolvedSource);
        const expectedRuntimeVersion = rootPackageLock.packages['node_modules/@capacitor/ios'].version;
        const capacitorPins = iosPackageResolved.pins.filter(
            (pin) => pin.identity === 'capacitor-swift-pm'
        );
        const ionCameraPins = iosPackageResolved.pins.filter(
            (pin) => pin.identity === 'ion-ios-camera'
        );

        expect(iosPackage).toContain(
            `.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${expectedRuntimeVersion}")`
        );
        expect(capacitorPins).toHaveLength(1);
        expect(capacitorPins[0]).toMatchObject({
            location: 'https://github.com/ionic-team/capacitor-swift-pm.git',
            state: { version: expectedRuntimeVersion }
        });
        expect(ionCameraPins).toHaveLength(1);
        expect(ionCameraPins[0]).toMatchObject({
            location: 'https://github.com/ionic-team/ion-ios-camera.git',
            state: { version: '1.0.5' }
        });
        expect(iosPackage).not.toContain('exact: "8.4.2"');
        expect(iosPackageResolvedSource).not.toMatch(
            /"identity"\s*:\s*"capacitor-swift-pm"[\s\S]*?"version"\s*:\s*"8\.4\.2"/
        );
    });

    it('keeps the synchronized Android runtime and camera plugin aligned with the JavaScript lockfile', () => {
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const androidSettings = readProjectFile('android/capacitor.settings.gradle');
        const androidAppBuild = readProjectFile('android/app/build.gradle');
        const androidBuild = readProjectFile('android/app/capacitor.build.gradle');
        const androidProject = [
            readProjectFile('android/settings.gradle'),
            readProjectFile('android/build.gradle'),
            androidAppBuild,
            androidSettings,
            androidBuild
        ].join('\n');

        expect(rootPackageLock.packages['node_modules/@capacitor/android'].version).toBe('8.5.0');
        expect(rootPackageLock.packages['node_modules/@capacitor/core'].version).toBe('8.5.0');
        expect(androidSettings).toContain("project(':capacitor-android').projectDir = new File('../node_modules/@capacitor/android/capacitor')");
        expect(androidSettings).toContain("project(':capacitor-camera').projectDir = new File('../node_modules/@capacitor/camera/android')");
        expect(androidAppBuild).toContain("implementation project(':capacitor-android')");
        expect(androidBuild).toContain("implementation project(':capacitor-camera')");
        expect(androidProject).not.toContain('8.4.2');
    });

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
        expect(config.plugins.SystemBars).toMatchObject({
            insetsHandling: 'disable'
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

        expect(appPackage.devDependencies.vite).toBe('^8.2.0');
        expect(appPackageLock.packages[''].devDependencies.vite).toBe('^8.2.0');
        expect(appPackageLock.packages['node_modules/vite'].version).toBe('8.2.0');
        expect(appPnpmLock).toContain('vite@8.2.0:');
        const pluginReactVersion = appPackage.devDependencies['@vitejs/plugin-react'].replace(/^\^/, '');
        expect(appPackageLock.packages['node_modules/@vitejs/plugin-react'].version).toBe(pluginReactVersion);
        expect(appPnpmLock).toContain(`'@vitejs/plugin-react@${pluginReactVersion}(vite@8.2.0`);
    });

    it('keeps app dependency maintenance updates aligned across the manifest and lockfiles', () => {
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = parseYaml(readProjectFile('apps/app/pnpm-lock.yaml'));
        const expectedDependencies = {
            'lucide-react': { group: 'dependencies', specifier: '^1.28.0', version: '1.28.0' },
            'react-router-dom': { group: 'dependencies', specifier: '7.18.2', version: '7.18.2' },
            'web-vitals': { group: 'dependencies', specifier: '^6.0.1', version: '6.1.0' },
            globals: { group: 'devDependencies', specifier: '^17.9.0', version: '17.9.0' },
            postcss: { group: 'devDependencies', specifier: '^8.5.25', version: '8.5.25' }
        };

        Object.entries(expectedDependencies).forEach(([dependency, expected]) => {
            const pnpmDependency = appPnpmLock.importers['.'][expected.group][dependency];

            expect(appPackage[expected.group][dependency]).toBe(expected.specifier);
            expect(appPackageLock.packages[''][expected.group][dependency]).toBe(expected.specifier);
            expect(appPackageLock.packages[`node_modules/${dependency}`].version).toBe(expected.version);
            expect(pnpmDependency.specifier).toBe(expected.specifier);
            expect(pnpmDependency.version).toMatch(new RegExp(`^${expected.version.replaceAll('.', '\\.')}(?:$|\\()`));
            expect(appPnpmLock.packages[`${dependency}@${expected.version}`]).toBeDefined();
        });
    });

    it('keeps the pnpm jsdom dependency graph aligned with the app update', () => {
        const appPnpmLock = parseYaml(readProjectFile('apps/app/pnpm-lock.yaml'));
        const jsdomDependency = appPnpmLock.importers['.'].devDependencies.jsdom;

        expect(jsdomDependency).toEqual({ specifier: '^30.0.1', version: '30.0.1' });
        expect(appPnpmLock.packages['jsdom@30.0.1']).toBeDefined();
        expect(appPnpmLock.packages['jsdom@29.1.1']).toBeUndefined();
        expect(appPnpmLock.packages['undici@8.10.0'].engines.node).toBe('>=22.19.0');
        expect(appPnpmLock.packages['undici@7.28.0']).toBeUndefined();
    });

    it('forces patched glob dependency versions throughout the app npm lockfile', () => {
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const patchedVersions = {
            'brace-expansion': '5.0.8',
            minimatch: '10.2.5'
        };

        expect(appPackage.overrides).toEqual(patchedVersions);

        Object.entries(patchedVersions).forEach(([dependency, version]) => {
            const resolvedVersions = Object.entries(appPackageLock.packages)
                .filter(([path]) => path === `node_modules/${dependency}` || path.endsWith(`/node_modules/${dependency}`))
                .map(([, packageMetadata]) => packageMetadata.version);

            expect(resolvedVersions).not.toHaveLength(0);
            expect(new Set(resolvedVersions)).toEqual(new Set([version]));
        });
    });

    it('wires App Check into both native shells without a SwiftPM identity collision', () => {
        const config = JSON.parse(readProjectFile('capacitor.config.json'));
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = parseYaml(readProjectFile('apps/app/pnpm-lock.yaml'));
        const androidSettings = readProjectFile('android/capacitor.settings.gradle');
        const androidBuild = readProjectFile('android/app/capacitor.build.gradle');
        const iosPackage = readProjectFile('ios/App/CapApp-SPM/Package.swift');
        const iosEntitlements = readProjectFile('ios/App/App/App.entitlements');
        const iosAppDelegate = readProjectFile('ios/App/App/AppDelegate.swift');

        const appCheckPackage = '@capacitor-firebase/app-check';
        const appCheckVersion = '8.4.0';

        expect(rootPackage.dependencies[appCheckPackage]).toBe(appCheckVersion);
        expect(appPackage.dependencies[appCheckPackage]).toBe(appCheckVersion);
        expect(rootPackageLock.packages[''].dependencies[appCheckPackage]).toBe(appCheckVersion);
        expect(appPackageLock.packages[''].dependencies[appCheckPackage]).toBe(appCheckVersion);
        expect(rootPackageLock.packages[`node_modules/${appCheckPackage}`].version).toBe(appCheckVersion);
        expect(appPackageLock.packages[`node_modules/${appCheckPackage}`].version).toBe(appCheckVersion);
        expect(appPnpmLock.importers['.'].dependencies[appCheckPackage].specifier).toBe(appCheckVersion);
        expect(appPnpmLock.importers['.'].dependencies[appCheckPackage].version).toMatch(/^8\.4\.0(?:$|\()/);
        expect(appPnpmLock.packages[`${appCheckPackage}@${appCheckVersion}`]).toBeDefined();
        expect(Object.keys(appPnpmLock.snapshots)).toContainEqual(expect.stringMatching(/^@capacitor-firebase\/app-check@8\.4\.0\(/));
        expect(androidSettings).toContain("include ':capacitor-firebase-app-check'");
        expect(androidBuild).toContain("implementation project(':capacitor-firebase-app-check')");
        expect(config.experimental.ios.spm.packageOptions['@capacitor-firebase/app-check']).toEqual({
            symlink: true
        });
        expect(iosPackage).toContain('path: "symlinks/CapacitorFirebaseAppCheck"');
        expect(iosEntitlements).toContain('com.apple.developer.devicecheck.appattest-environment');
        expect(iosEntitlements).toContain('<string>production</string>');

        const launchSetup = iosAppDelegate.slice(
            iosAppDelegate.indexOf('didFinishLaunchingWithOptions'),
            iosAppDelegate.indexOf('func applicationWillResignActive')
        );
        expect(iosAppDelegate).toContain('import FirebaseAppCheck');
        expect(iosAppDelegate).toContain('import FirebaseCore');
        expect(iosAppDelegate).toContain('return AppAttestProvider(app: app)');
        expect(launchSetup).toContain('#if DEBUG');
        expect(launchSetup).toContain('AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())');
        expect(launchSetup).toContain('#else');
        expect(launchSetup).toContain('AppCheck.setAppCheckProviderFactory(AllPlaysAppCheckProviderFactory())');
        expect(launchSetup.indexOf('AppCheck.setAppCheckProviderFactory')).toBeLessThan(
            launchSetup.indexOf('return true')
        );
        expect(launchSetup).not.toContain('FirebaseApp.configure()');
    });

    it('uses an explicit token-free App Check debug build only for local simulator and debug APK commands', () => {
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));

        expect(appPackage.scripts['build:native-debug']).toContain('vite build --mode native-debug');
        expect(appPackage.scripts['build:native-debug']).toContain('ALLPLAYS_APP_CHECK_NATIVE_DEBUG=1');
        expect(appPackage.scripts['build:native-debug']).not.toContain('VITE_APP_CHECK_DEBUG_TOKEN');
        expect(rootPackage.scripts['mobile:sync:native-debug']).toContain('build:native-debug');
        expect(rootPackage.scripts['mobile:build:ios']).toContain('mobile:sync:native-debug');
        expect(rootPackage.scripts['mobile:build:ios']).toContain('-configuration Debug');
        expect(rootPackage.scripts['mobile:build:android']).toContain('mobile:sync:native-debug');
        expect(rootPackage.scripts['mobile:build:android']).toContain(':app:assembleDebug');
        expect(rootPackage.scripts['mobile:run:android']).toContain('mobile:sync:native-debug');
        expect(rootPackage.scripts['mobile:run:android']).not.toContain('app:build');

        expect(appPackage.scripts['build:native']).toContain('ALLPLAYS_CAPACITOR_BUILD=1');
        expect(appPackage.scripts['build:native']).not.toContain('ALLPLAYS_APP_CHECK_NATIVE_DEBUG');
        expect(rootPackage.scripts['app:build']).not.toContain('native-debug');
        expect(rootPackage.scripts['app:build']).not.toContain('app:build:native');
        expect(rootPackage.scripts['app:build:native']).toContain('build:native');
        expect(rootPackage.scripts['mobile:sync']).toBe('npm run app:build:native && npx cap sync');
        expect(rootPackage.scripts['mobile:sync']).not.toContain('native-debug');
    });

    it('keeps Vitest and coverage peer versions aligned in app lockfiles', () => {
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = readProjectFile('apps/app/pnpm-lock.yaml');
        const vitestVersion = appPackage.devDependencies.vitest.replace(/^\^/, '');

        expect(appPackage.devDependencies['@vitest/coverage-v8']).toBe(`^${vitestVersion}`);
        expect(appPackageLock.packages[''].devDependencies.vitest).toBe(`^${vitestVersion}`);
        expect(appPackageLock.packages['node_modules/vitest'].version).toBe(vitestVersion);
        expect(appPackageLock.packages['node_modules/@vitest/coverage-v8'].peerDependencies.vitest).toBe(vitestVersion);
        expect(appPnpmLock).toContain(`version: ${vitestVersion}(vitest@${vitestVersion})`);
        expect(appPnpmLock).toContain(`'@vitest/coverage-v8@${vitestVersion}(vitest@${vitestVersion})':`);
        expect(appPnpmLock).not.toContain(`'@vitest/coverage-v8@${vitestVersion}(vitest@4.1.9)'`);
    });

    it('keeps shared dependency maintenance versions aligned across manifests and lockfiles', () => {
        const rootPackage = JSON.parse(readProjectFile('package.json'));
        const appPackage = JSON.parse(readProjectFile('apps/app/package.json'));
        const rootPackageLock = JSON.parse(readProjectFile('package-lock.json'));
        const appPackageLock = JSON.parse(readProjectFile('apps/app/package-lock.json'));
        const appPnpmLock = readProjectFile('apps/app/pnpm-lock.yaml');
        const expectedDependencies = {
            '@capacitor/camera': { specifier: '^8.2.2', version: '8.2.2' },
            firebase: { specifier: '12.17.1', version: '12.17.1' },
            'web-vitals': { specifier: '^6.0.1', version: '6.1.0' }
        };

        Object.entries(expectedDependencies).forEach(([dependency, expected]) => {
            expect(rootPackage.dependencies[dependency]).toBe(expected.specifier);
            expect(appPackage.dependencies[dependency]).toBe(expected.specifier);
            expect(rootPackageLock.packages[''].dependencies[dependency]).toBe(expected.specifier);
            expect(appPackageLock.packages[''].dependencies[dependency]).toBe(expected.specifier);
            expect(rootPackageLock.packages[`node_modules/${dependency}`].version).toBe(expected.version);
            expect(appPackageLock.packages[`node_modules/${dependency}`].version).toBe(expected.version);
        });

        expect(appPnpmLock).toContain("'@capacitor/camera@8.2.2':");
        expect(appPnpmLock).toContain('firebase@12.17.1:');
        expect(appPnpmLock).not.toContain('firebase@12.17.0:');
        expect(appPnpmLock).toContain('web-vitals@6.1.0:');
        const expectedPluginVersions = {
            '@capacitor-firebase/app-check': '8.4.0',
            '@capacitor-firebase/authentication': '8.3.0',
            '@capacitor-firebase/messaging': '8.3.0',
            '@capacitor-firebase/performance': '8.3.0'
        };
        Object.entries(expectedPluginVersions).forEach(([plugin, version]) => {
            expect(appPnpmLock).toContain(`${plugin}@${version}(@capacitor/core@8.5.0)(firebase@12.17.1)`);
            expect(appPnpmLock).not.toContain(`${plugin}@${version}(@capacitor/core@8.5.0)(firebase@12.17.0)`);
        });
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
