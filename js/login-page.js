export function getPasswordResetErrorMessage(error) {
    if (error?.code === 'auth/invalid-email') {
        return 'Invalid email address format.';
    }

    if (error?.code === 'auth/user-not-found') {
        return 'No account found with this email address.';
    }

    if (error?.code === 'auth/too-many-requests') {
        return 'Too many requests. Please try again later.';
    }

    return error?.message || 'Unable to reset password right now.';
}

function showPasswordResetMessage(errorDiv, message, isSuccess) {
    errorDiv.classList.remove('hidden', 'text-red-500', 'text-green-600');
    errorDiv.classList.add(isSuccess ? 'text-green-600' : 'text-red-500');
    errorDiv.textContent = message;
}

export function createForgotPasswordHandler({ emailInput, errorDiv, resetPassword }) {
    return async function handleForgotPasswordClick() {
        errorDiv.classList.add('hidden');
        errorDiv.classList.remove('text-green-600');
        errorDiv.classList.add('text-red-500');

        const email = emailInput.value.trim();
        if (!email) {
            showPasswordResetMessage(errorDiv, 'Please enter your email address', false);
            return;
        }

        try {
            await resetPassword(email);
            emailInput.value = '';
            showPasswordResetMessage(
                errorDiv,
                'Password reset email sent! Please check your inbox and spam folder.',
                true
            );
        } catch (error) {
            showPasswordResetMessage(errorDiv, getPasswordResetErrorMessage(error), false);
            console.error('Password reset error:', error);
        }
    };
}
