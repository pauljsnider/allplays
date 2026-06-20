// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DetailLoadErrorState } from './DetailLoadErrorState';

describe('DetailLoadErrorState', () => {
    it('falls back when the error message is missing', () => {
        const onRetry = vi.fn();
        const error = {
            name: 'AppServiceError',
            type: 'unknown',
            message: undefined
        } as unknown as Parameters<typeof DetailLoadErrorState>[0]['error'];

        render(
            <MemoryRouter>
                <DetailLoadErrorState
                    icon={AlertTriangle}
                    title="Unable to load player"
                    error={error}
                    fallbackMessage="An error occurred"
                    backTo="/home"
                    backLabel="Back home"
                    onRetry={onRetry}
                />
            </MemoryRouter>
        );

        expect(screen.getByText('An error occurred')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
