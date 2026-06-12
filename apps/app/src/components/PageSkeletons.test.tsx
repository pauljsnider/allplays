// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProtectedRouteSkeleton } from './PageSkeletons';

describe('ProtectedRouteSkeleton', () => {
  it.each([
    ['/home', 'Loading Home'],
    ['/schedule', 'Loading schedule'],
    ['/schedule/team-1/event-1', 'Loading event'],
    ['/messages', 'Loading team chats'],
    ['/messages/team-1', 'Loading team chat'],
    ['/teams/team-1', 'Loading team']
  ])('renders the right skeleton for %s', (pathname, label) => {
    render(<ProtectedRouteSkeleton pathname={pathname} />);
    expect(screen.getByRole('status', { name: label })).toBeTruthy();
  });
});
