import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app schedule event detail mobile layout', () => {
    it('keeps the mobile event summary shell padding and meta spacing compact', () => {
        const source = readFileSync(resolve('apps/app/src/pages/ScheduleEventDetail.tsx'), 'utf8');

        expect(source).toContain('event-summary-shell px-3 py-1.5 sm:p-4');
        expect(source).toContain('mt-0 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-xs font-bold leading-5 text-gray-600 sm:text-sm');
        expect(source).toContain('mt-1 flex min-w-0 items-center justify-between gap-2 sm:mt-2');
    });
});
