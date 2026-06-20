// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearScrollRestorationForTests, ScrollRestoration } from './ScrollRestoration';

let scrollYValue = 0;
const scrollToMock = vi.fn((optionsOrX: ScrollToOptions | number, y?: number) => {
  scrollYValue = typeof optionsOrX === 'number'
    ? Number(y || 0)
    : Number(optionsOrX.top || 0);
});

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back</button>;
}

function TestRoutes() {
  return (
    <>
      <ScrollRestoration />
      <Routes>
        <Route path="/" element={<Link to="/detail">Open detail</Link>} />
        <Route path="/detail" element={<BackButton />} />
      </Routes>
    </>
  );
}

describe('ScrollRestoration', () => {
  beforeEach(() => {
    scrollYValue = 0;
    scrollToMock.mockClear();
    clearScrollRestorationForTests();
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollYValue
    });
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      get: () => scrollYValue
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToMock
    });
  });

  it('restores the previous entry scroll on back navigation and starts pushed pages at top', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TestRoutes />
      </MemoryRouter>
    );

    await waitFor(() => expect(scrollToMock).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' }));

    scrollYValue = 420;
    fireEvent.click(screen.getByRole('link', { name: 'Open detail' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy());
    await waitFor(() => expect(scrollToMock).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' }));

    scrollYValue = 80;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Open detail' })).toBeTruthy());
    await waitFor(() => expect(scrollToMock).toHaveBeenLastCalledWith({ top: 420, left: 0, behavior: 'auto' }));
  });
});
