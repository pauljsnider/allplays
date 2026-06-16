import { describe, expect, it } from 'vitest';
import { AppServiceError, toAppServiceError } from '../../apps/app/src/lib/appErrors.ts';

describe('appErrors', () => {
    it('classifies shared app service error types', () => {
        expect(toAppServiceError(new TypeError('Failed to fetch'), 'fallback')).toMatchObject({
            name: 'AppServiceError',
            type: 'network'
        });
        expect(toAppServiceError(new Error('Permission denied for this team'), 'fallback')).toMatchObject({
            type: 'permission'
        });
        expect(toAppServiceError({ message: 'Schedule not found', status: 404 }, 'fallback')).toMatchObject({
            type: 'not_found'
        });
        expect(toAppServiceError({ message: 'Select a team first', status: 422 }, 'fallback')).toMatchObject({
            type: 'validation'
        });
    });

    it('passes through existing AppServiceError instances', () => {
        const original = new AppServiceError('permission', 'Already typed.');
        expect(toAppServiceError(original, 'fallback')).toBe(original);
    });
});
