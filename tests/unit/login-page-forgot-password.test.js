import { describe, it, expect, vi } from 'vitest';
import { createForgotPasswordHandler, getPasswordResetErrorMessage } from '../../js/login-page.js';

function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);

    return {
        add: (...tokens) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
        contains: (token) => classes.has(token),
        toArray: () => Array.from(classes)
    };
}

function createElements({ email = '', errorClasses = ['hidden', 'text-red-500'] } = {}) {
    return {
        emailInput: { value: email },
        errorDiv: {
            textContent: '',
            classList: createClassList(errorClasses)
        }
    };
}

describe('createForgotPasswordHandler', () => {
    it('calls resetPassword, clears the email field, and shows the success message', async () => {
        const resetPassword = vi.fn().mockResolvedValue(undefined);
        const { emailInput, errorDiv } = createElements({ email: 'player@example.com' });

        await createForgotPasswordHandler({ emailInput, errorDiv, resetPassword })();

        expect(resetPassword).toHaveBeenCalledWith('player@example.com');
        expect(emailInput.value).toBe('');
        expect(errorDiv.textContent).toBe('Password reset email sent! Please check your inbox and spam folder.');
        expect(errorDiv.classList.contains('text-green-600')).toBe(true);
        expect(errorDiv.classList.contains('text-red-500')).toBe(false);
    });

    it('maps Firebase reset errors to user-facing messages', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const scenarios = [
            ['auth/invalid-email', 'Invalid email address format.'],
            ['auth/user-not-found', 'No account found with this email address.'],
            ['auth/too-many-requests', 'Too many requests. Please try again later.']
        ];

        for (const [code, expectedMessage] of scenarios) {
            const resetPassword = vi.fn().mockRejectedValue({ code, message: 'raw firebase error' });
            const { emailInput, errorDiv } = createElements({ email: 'player@example.com' });

            await createForgotPasswordHandler({ emailInput, errorDiv, resetPassword })();

            expect(errorDiv.textContent).toBe(expectedMessage);
            expect(errorDiv.classList.contains('text-red-500')).toBe(true);
            expect(errorDiv.classList.contains('text-green-600')).toBe(false);
        }

        consoleErrorSpy.mockRestore();
    });

    it('resets validation styling after a prior success state', async () => {
        const resetPassword = vi.fn().mockResolvedValue(undefined);
        const { emailInput, errorDiv } = createElements({
            email: '',
            errorClasses: ['text-green-600']
        });

        await createForgotPasswordHandler({ emailInput, errorDiv, resetPassword })();

        expect(resetPassword).not.toHaveBeenCalled();
        expect(errorDiv.textContent).toBe('Please enter your email address');
        expect(errorDiv.classList.contains('text-red-500')).toBe(true);
        expect(errorDiv.classList.contains('text-green-600')).toBe(false);
    });
});

describe('getPasswordResetErrorMessage', () => {
    it('falls back to the original error message for unknown Firebase errors', () => {
        expect(getPasswordResetErrorMessage({ code: 'auth/internal-error', message: 'Service unavailable' }))
            .toBe('Service unavailable');
    });
});
