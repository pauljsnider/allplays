// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { UserCircle } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { AvatarImage } from './AvatarImage';

describe('AvatarImage', () => {
    it('renders the image when the src loads normally', () => {
        render(
            <AvatarImage
                src="https://example.com/photo-ok.png"
                alt="Profile photo"
                className="h-full w-full object-cover"
                fallback={<UserCircle data-testid="fallback-icon" aria-hidden="true" />}
            />
        );

        const image = screen.getByRole('img', { name: 'Profile photo' });
        expect(image.getAttribute('src')).toBe('https://example.com/photo-ok.png');
        expect(image.getAttribute('class')).toBe('h-full w-full object-cover');
        expect(screen.queryByTestId('fallback-icon')).toBeNull();
    });

    it('swaps to the fallback and logs the failing URL once when the image errors', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { unmount } = render(
            <AvatarImage
                src="https://example.com/photo-broken.png"
                alt="Profile photo"
                fallback={<UserCircle data-testid="fallback-icon" aria-hidden="true" />}
            />
        );

        fireEvent.error(screen.getByRole('img', { name: 'Profile photo' }));

        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByTestId('fallback-icon')).toBeTruthy();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warnSpy.mock.calls[0])).toContain('https://example.com/photo-broken.png');

        // A remount that fails on the same URL should not log again.
        unmount();
        render(
            <AvatarImage
                src="https://example.com/photo-broken.png"
                alt="Profile photo"
                fallback={<UserCircle data-testid="fallback-icon" aria-hidden="true" />}
            />
        );
        fireEvent.error(screen.getByRole('img', { name: 'Profile photo' }));
        expect(warnSpy).toHaveBeenCalledTimes(1);

        warnSpy.mockRestore();
    });

    it('retries the image when the src changes after a failure', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { rerender } = render(
            <AvatarImage
                src="https://example.com/photo-stale.png"
                alt="Profile photo"
                fallback={<UserCircle data-testid="fallback-icon" aria-hidden="true" />}
            />
        );

        fireEvent.error(screen.getByRole('img', { name: 'Profile photo' }));
        expect(screen.getByTestId('fallback-icon')).toBeTruthy();

        rerender(
            <AvatarImage
                src="https://example.com/photo-fresh.png"
                alt="Profile photo"
                fallback={<UserCircle data-testid="fallback-icon" aria-hidden="true" />}
            />
        );

        const image = screen.getByRole('img', { name: 'Profile photo' });
        expect(image.getAttribute('src')).toBe('https://example.com/photo-fresh.png');
        expect(screen.queryByTestId('fallback-icon')).toBeNull();

        warnSpy.mockRestore();
    });

    it('renders string fallbacks such as initials', () => {
        const { container } = render(
            <AvatarImage
                src="https://example.com/photo-missing.png"
                fallback="PS"
            />
        );

        const image = container.querySelector('img');
        expect(image).toBeTruthy();
        fireEvent.error(image as HTMLImageElement);
        expect(screen.getByText('PS')).toBeTruthy();
    });
});
