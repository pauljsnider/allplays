import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAuthenticatedAppSession } from '../../tests/smoke/helpers/app-auth.js';

describe('authenticated smoke session cleanup', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not let a pending browser-context close hide the authentication failure', async () => {
        vi.useFakeTimers();
        const context = {
            close: vi.fn(() => new Promise(() => {}))
        };
        let settled = false;
        const cleanup = closeAuthenticatedAppSession({ context }).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await cleanup;

        expect(settled).toBe(true);
        expect(context.close).toHaveBeenCalledOnce();
    });

    it('still awaits a context that closes normally', async () => {
        const context = {
            close: vi.fn().mockResolvedValue(undefined)
        };

        await closeAuthenticatedAppSession({ context });

        expect(context.close).toHaveBeenCalledOnce();
    });
});
