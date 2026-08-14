import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    hasSelfTokenCreatorBinding,
    serviceAccountTokenCreatorRole
} from '../../scripts/verify-native-web-auth-iam.mjs';

const runtimeServiceAccount = 'game-flow-c6311@appspot.gserviceaccount.com';

describe('native WebView custom-token deployment IAM', () => {
    it('accepts only an exact self-binding for Service Account Token Creator', () => {
        expect(hasSelfTokenCreatorBinding({
            bindings: [{
                role: serviceAccountTokenCreatorRole,
                members: [`serviceAccount:${runtimeServiceAccount}`]
            }]
        }, runtimeServiceAccount)).toBe(true);
    });

    it('rejects the role when it is granted only to the deploy principal', () => {
        expect(hasSelfTokenCreatorBinding({
            bindings: [{
                role: serviceAccountTokenCreatorRole,
                members: ['serviceAccount:github-deploy@game-flow-c6311.iam.gserviceaccount.com']
            }]
        }, runtimeServiceAccount)).toBe(false);
    });

    it('rejects broad roles that do not provide custom-token signing', () => {
        expect(hasSelfTokenCreatorBinding({
            bindings: [{
                role: 'roles/editor',
                members: [`serviceAccount:${runtimeServiceAccount}`]
            }]
        }, runtimeServiceAccount)).toBe(false);
    });

    it('rejects a conditional self-binding whose applicability is not verified', () => {
        expect(hasSelfTokenCreatorBinding({
            bindings: [{
                role: serviceAccountTokenCreatorRole,
                members: [`serviceAccount:${runtimeServiceAccount}`],
                condition: {
                    title: 'expired-token-creator-grant',
                    expression: 'request.time < timestamp("2025-01-01T00:00:00Z")'
                }
            }]
        }, runtimeServiceAccount)).toBe(false);
    });

    it('fails closed for malformed policy or service-account input', () => {
        expect(hasSelfTokenCreatorBinding({}, runtimeServiceAccount)).toBe(false);
        expect(hasSelfTokenCreatorBinding({ bindings: [] }, 'not-an-account')).toBe(false);
    });

    it('blocks production deployment unless the runtime policy passes the verifier', () => {
        const workflow = readFileSync(
            new URL('../../.github/workflows/deploy-prod.yml', import.meta.url),
            'utf8'
        );

        expect(workflow).toContain('gcloud iam service-accounts get-iam-policy');
        expect(workflow).toContain(runtimeServiceAccount);
        expect(workflow).toContain('node scripts/verify-native-web-auth-iam.mjs');
        expect(workflow).toContain('--service-account "$native_web_auth_runtime_service_account"');
    });
});
