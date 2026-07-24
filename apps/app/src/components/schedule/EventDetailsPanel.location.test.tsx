// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventDetailsPanel } from './EventDetailsPanel';

describe('EventDetailsPanel calendar locations', () => {
  it('renders an imported calendar field detail with its venue', () => {
    render(
      <EventDetailsPanel
        open
        event={{
          eventKey: 'team-1::calendar-1::player-1',
          id: 'calendar-1',
          teamId: 'team-1',
          teamName: 'Mustangs',
          type: 'game',
          date: new Date('2026-06-19T18:00:00.000Z'),
          location: 'Blue Valley Recreation Sports Complex',
          locationDetail: 'Field 14',
          opponent: 'Jaguars',
          childId: 'player-1',
          childName: 'Avery',
          isDbGame: false,
          isCancelled: false,
          assignments: [],
          openAssignmentCount: 0
        }}
      />
    );

    expect(screen.getByText('Blue Valley Recreation Sports Complex · Field 14')).toBeTruthy();
  });
});
