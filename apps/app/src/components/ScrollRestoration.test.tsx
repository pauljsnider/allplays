// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function HomeRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <Link to="/detail">Open detail</Link>
      <button type="button" onClick={() => navigate(`${location.pathname}?panel=filters`, { replace: true })}>Replace filters</button>
      <span data-testid="current-search">{location.search}</span>
    </>
  );
}

function TestRoutes() {
  return (
    <>
      <ScrollRestoration />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/detail" element={<BackButton />} />
      </Routes>
    </>
  );
}

describe('ScrollRestoration', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('preserves scroll when replacing query params on the same page', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TestRoutes />
      </MemoryRouter>
    );

    await waitFor(() => expect(scrollToMock).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' }));

    scrollToMock.mockClear();
    scrollYValue = 360;
    fireEvent.click(screen.getByRole('button', { name: 'Replace filters' }));

    await waitFor(() => expect(screen.getByTestId('current-search').textContent).toBe('?panel=filters'));
    expect(scrollYValue).toBe(360);
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});
