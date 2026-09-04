import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(
    new URL('../../ios/App/App/PrivacyInfo.xcprivacy', import.meta.url),
    'utf8'
);

const requiredLinkedDataTypes = [
    'Name',
    'EmailAddress',
    'PhoneNumber',
    'CoarseLocation',
    'PhysicalAddress',
    'OtherUserContactInfo',
    'Health',
    'Fitness',
    'Contacts',
    'EmailsOrTextMessages',
    'PhotosorVideos',
    'AudioData',
    'OtherUserContent',
    'CustomerSupport',
    'UserID',
    'DeviceID',
    'PurchaseHistory',
    'OtherFinancialInfo',
    'ProductInteraction',
    'CrashData',
    'PerformanceData',
    'OtherDiagnosticData',
    'OtherDataTypes'
];

const appleSupportedCollectedDataTypes = new Set([
    'NSPrivacyCollectedDataTypeName',
    'NSPrivacyCollectedDataTypeEmailAddress',
    'NSPrivacyCollectedDataTypePhoneNumber',
    'NSPrivacyCollectedDataTypePhysicalAddress',
    'NSPrivacyCollectedDataTypeOtherUserContactInfo',
    'NSPrivacyCollectedDataTypeHealth',
    'NSPrivacyCollectedDataTypeFitness',
    'NSPrivacyCollectedDataTypePaymentInfo',
    'NSPrivacyCollectedDataTypeCreditInfo',
    'NSPrivacyCollectedDataTypeOtherFinancialInfo',
    'NSPrivacyCollectedDataTypePreciseLocation',
    'NSPrivacyCollectedDataTypeCoarseLocation',
    'NSPrivacyCollectedDataTypeSensitiveInfo',
    'NSPrivacyCollectedDataTypeContacts',
    'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
    'NSPrivacyCollectedDataTypePhotosorVideos',
    'NSPrivacyCollectedDataTypeAudioData',
    'NSPrivacyCollectedDataTypeGameplayContent',
    'NSPrivacyCollectedDataTypeCustomerSupport',
    'NSPrivacyCollectedDataTypeOtherUserContent',
    'NSPrivacyCollectedDataTypeBrowsingHistory',
    'NSPrivacyCollectedDataTypeSearchHistory',
    'NSPrivacyCollectedDataTypeUserID',
    'NSPrivacyCollectedDataTypeDeviceID',
    'NSPrivacyCollectedDataTypePurchaseHistory',
    'NSPrivacyCollectedDataTypeProductInteraction',
    'NSPrivacyCollectedDataTypeAdvertisingData',
    'NSPrivacyCollectedDataTypeOtherUsageData',
    'NSPrivacyCollectedDataTypeCrashData',
    'NSPrivacyCollectedDataTypePerformanceData',
    'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    'NSPrivacyCollectedDataTypeEnvironmentScanning',
    'NSPrivacyCollectedDataTypeHands',
    'NSPrivacyCollectedDataTypeHead',
    'NSPrivacyCollectedDataTypeBody',
    'NSPrivacyCollectedDataTypeOtherDataTypes'
]);

describe('iOS privacy manifest', () => {
    it('declares the Capacitor Filesystem required-reason API', () => {
        expect(manifest).toContain('<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>');
        expect(manifest).toContain('<string>C617.1</string>');
    });

    it('declares each collected data type once and does not claim tracking', () => {
        expect(manifest).toContain('<key>NSPrivacyTracking</key>\n\t<false/>');
        expect(manifest).toContain('<key>NSPrivacyTrackingDomains</key>\n\t<array/>');

        requiredLinkedDataTypes.forEach((suffix) => {
            const token = `<string>NSPrivacyCollectedDataType${suffix}</string>`;
            expect(manifest.split(token)).toHaveLength(2);
        });

        const entries = manifest.match(/<dict>\s*<key>NSPrivacyCollectedDataType<\/key>[\s\S]*?<\/dict>/g) || [];
        expect(entries).toHaveLength(requiredLinkedDataTypes.length);
        entries.forEach((entry) => {
            const declaredType = entry.match(/<string>(NSPrivacyCollectedDataType[^<]+)<\/string>/)?.[1];
            expect(appleSupportedCollectedDataTypes.has(declaredType || '')).toBe(true);
            expect(entry).toContain('<key>NSPrivacyCollectedDataTypeLinked</key>\n\t\t\t<true/>');
            expect(entry).toContain('<key>NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<false/>');
            expect(entry).toContain('<key>NSPrivacyCollectedDataTypePurposes</key>');
        });
    });

    it('uses analytics only for the IP-derived coarse-location declaration', () => {
        const entry = manifest.match(/<dict>\s*<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataTypeCoarseLocation<\/string>[\s\S]*?<\/dict>/)?.[0];

        expect(entry).toContain('NSPrivacyCollectedDataTypePurposeAnalytics');
        expect(entry).not.toContain('NSPrivacyCollectedDataTypePurposeAppFunctionality');
    });
});
