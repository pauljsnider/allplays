import { describe, expect, it, vi } from 'vitest';
import {
    APP_AUDIT_ARGS,
    validateAppAuditReport,
    validateAppAuditResult
} from '../../scripts/audit-app-dependencies.mjs';

const reviewedReport = {
    auditReportVersion: 2,
    vulnerabilities: {
        'react-router': {
            name: 'react-router',
            severity: 'high',
            via: [{
                title: 'React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response',
                url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
            }]
        },
        'react-router-dom': {
            name: 'react-router-dom',
            severity: 'high',
            via: ['react-router']
        }
    },
    metadata: {
        vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 2,
            critical: 0,
            total: 2
        }
    }
};

describe('app dependency audit exception', () => {
    it('audits shipped app dependencies without development-only tooling', () => {
        expect(APP_AUDIT_ARGS).toContain('--omit=dev');
    });

    it('allows only the temporary client-inapplicable React Router RSC advisory', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => validateAppAuditReport(reviewedReport, new Date('2026-07-24T00:00:00Z'))).not.toThrow();
    });

    it('rejects any additional moderate-or-higher vulnerability', () => {
        const report = structuredClone(reviewedReport);
        report.vulnerabilities.firebase = {
            name: 'firebase',
            severity: 'moderate',
            via: [{ title: 'Unexpected advisory', url: 'https://example.com/advisory' }]
        };

        expect(() => validateAppAuditReport(report, new Date('2026-07-24T00:00:00Z')))
            .toThrow('outside the reviewed React Router RSC exception');
    });

    it('expires the exception promptly', () => {
        expect(() => validateAppAuditReport(reviewedReport, new Date('2026-08-08T00:00:00Z')))
            .toThrow('exception expired');
    });

    it('rejects registry error JSON instead of treating it as a clean audit', () => {
        expect(() => validateAppAuditResult({
            status: 1,
            signal: null,
            stdout: JSON.stringify({ message: '403 Forbidden' }),
            stderr: ''
        })).toThrow('invalid or error-shaped report');
    });

    it('rejects a failure to start npm audit', () => {
        expect(() => validateAppAuditResult({
            error: new Error('spawn npm ENOENT'),
            status: null,
            signal: null,
            stdout: '',
            stderr: ''
        })).toThrow('npm audit could not start');
    });
});
