import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app public actions native wiring', () => {
    it('registers public action plugins in the app package plus Android and iOS Capacitor manifests', () => {
        const appPackage = JSON.parse(readFileSync('apps/app/package.json', 'utf8'));
        const androidBuild = readFileSync('android/app/capacitor.build.gradle', 'utf8');
        const androidSettings = readFileSync('android/capacitor.settings.gradle', 'utf8');
        const androidVariables = readFileSync('android/variables.gradle', 'utf8');
        const iosPackage = readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8');

        expect(appPackage.dependencies['@capacitor/filesystem']).toBeTruthy();
        expect(appPackage.dependencies['@capacitor/app-launcher']).toBeTruthy();
        expect(androidBuild).toContain("implementation project(':capacitor-filesystem')");
        expect(androidBuild).toContain("implementation project(':capacitor-app-launcher')");
        expect(androidSettings).toContain("include ':capacitor-filesystem'");
        expect(androidSettings).toContain("project(':capacitor-filesystem').projectDir = new File('../node_modules/@capacitor/filesystem/android')");
        expect(androidSettings).toContain("include ':capacitor-app-launcher'");
        expect(androidSettings).toContain("project(':capacitor-app-launcher').projectDir = new File('../node_modules/@capacitor/app-launcher/android')");
        expect(androidVariables).toContain("kotlin_version = '2.2.20'");
        expect(androidVariables).toContain("kotlinxCoroutinesVersion = '1.10.2'");
        expect(iosPackage).toContain('.package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem")');
        expect(iosPackage).toContain('.product(name: "CapacitorFilesystem", package: "CapacitorFilesystem")');
        expect(iosPackage).toContain('.package(name: "CapacitorAppLauncher", path: "../../../node_modules/@capacitor/app-launcher")');
        expect(iosPackage).toContain('.product(name: "CapacitorAppLauncher", package: "CapacitorAppLauncher")');
    });
});
