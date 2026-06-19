// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTile } from './DateTile';
import { EventBrief } from './EventBrief';
import { EventSectionNav } from './EventSectionNav';
import { PlayerInitials } from './PlayerInitials';

describe('Schedule event summary components', () => {
  it('renders the date tile month, day, and weekday', () => {
    render(<DateTile date={new Date('2026-06-19T18:00:00.000Z')} />);

    expect(screen.getByText('Jun')).toBeTruthy();
    expect(screen.getByText('19')).toBeTruthy();
    expect(screen.getByText('Fri')).toBeTruthy();
  });

  it('renders player initials and falls back when the name is blank', () => {
    const { rerender } = render(<PlayerInitials name="Avery Smith" />);

    expect(screen.getByText('AS')).toBeTruthy();

    rerender(<PlayerInitials name="   " />);
    expect(screen.getByText('P')).toBeTruthy();
  });

  it('renders event brief pills only when summary pieces exist', () => {
    const { container, rerender } = render(<EventBrief pieces={["Final 3-1", 'Home', 'Blue kit']} />);

    expect(screen.getByText('Final 3-1')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Blue kit')).toBeTruthy();

    rerender(<EventBrief pieces={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('marks the packet-ready section and calls onSelect with the clicked section id', () => {
    const onSelect = vi.fn();

    render(
      <EventSectionNav
        className="custom-nav"
        includeBaseClass={false}
        sections={[
          { id: 'availability', label: 'Availability' },
          { id: 'rideshare', label: 'Rideshare' },
          { id: 'assignments', label: 'Assignments' },
          { id: 'game', label: 'Game', shortLabel: 'More' }
        ]}
        activeSection="availability"
        hasPracticePacket
        onSelect={onSelect}
      />
    );

    const gameButton = screen.getByRole('button', { name: 'Game, packet ready' });
    fireEvent.click(gameButton);

    expect(onSelect).toHaveBeenCalledWith('game');
    expect(gameButton.textContent).toContain('More');
    expect(gameButton.parentElement?.parentElement?.className.includes('event-section-nav')).toBe(false);
  });
});
