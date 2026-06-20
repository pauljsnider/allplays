import { describe, expect, it } from 'vitest';
import {
    collectScannableFiles,
    scanTextForPrivateSecrets
} from '../../scripts/check-no-private-secrets.mjs';

describe('private secret scan', () => {
    it('allows public Firebase web config fields', () => {
        const findings = scanTextForPrivateSecrets(`
            export const config = {
                apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
                authDomain: 'game-flow-c6311.firebaseapp.com',
                projectId: 'game-flow-c6311',
                messagingSenderId: '1030107289033',
                appId: '1:1030107289033:web:7154238712942475143046'
            };
        `);

        expect(findings).toEqual([]);
    });

    it('flags private key and token material', () => {
        const privateKeyHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
        const privateKeyFooter = ['-----END', 'PRIVATE KEY-----'].join(' ');
        const githubToken = `ghp_${'1'.repeat(40)}`;
        const findings = scanTextForPrivateSecrets(`
            const serviceAccount = {
                "private_key": "${privateKeyHeader}\\nabc\\n${privateKeyFooter}"
            };
            const token = '${githubToken}';
        `, 'apps/app/src/bad.ts');

        expect(findings.map((finding) => finding.pattern)).toEqual([
            'private-key-block',
            'google-service-account-private-key',
            'github-token'
        ]);
        expect(findings[0]).toMatchObject({
            filePath: 'apps/app/src/bad.ts',
            line: 3
        });
    });

    it('scans only app source and legacy web files by default', async () => {
        const files = await collectScannableFiles(process.cwd());
        const relativeFiles = files.map((file) => file.replace(`${process.cwd()}/`, ''));

        expect(relativeFiles).toContain('js/firebase-runtime-config.js');
        expect(relativeFiles.some((file) => file.startsWith('apps/app/src/'))).toBe(true);
        expect(relativeFiles.some((file) => file.startsWith('tests/unit/'))).toBe(false);
    });
});
