// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import { AttentionPanel, type AttentionPanelItem } from './AttentionPanel';
import { AvailabilityNotesList } from './AvailabilityNotesList';
import { QuickAvailabilityPanel } from './QuickAvailabilityPanel';

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'team-1::game-1::player-1::2026-06-04T18:00:00.000Z::game',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2026-06-04T18:00:00.000Z'),
    location: 'Main Gym',
    childId: 'player-1',
    childName: 'Avery Smith',
    isDbGame: true,
    isCancelled: false,
    assignments: [],
    myRsvp: 'not_responded',
    myRsvpNote: '',
    availabilityNotesVisible: false,
    availabilityNotes: [],
    ...overrides
  };
}

describe('QuickAvailabilityPanel', () => {
  it('shows the loading state for the active RSVP action', () => {
    render(
      <QuickAvailabilityPanel
        event={buildEvent()}
        rsvp="going"
        canSubmitRsvp
        submitting="going"
        availabilityNote=""
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
  });

  it('keeps save-note gating trim-based for existing RSVPs', () => {
    render(
      <QuickAvailabilityPanel
        event={buildEvent({ myRsvp: 'going', myRsvpNote: 'Original note' })}
        rsvp="going"
        canSubmitRsvp
        submitting={null}
        availabilityNote=" Original note  "
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText('Availability saved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  });

  it('renders the unavailable state and disables editing when RSVP cannot be submitted', () => {
    render(
      <QuickAvailabilityPanel
        event={buildEvent()}
        rsvp="not_responded"
        canSubmitRsvp={false}
        submitting={null}
        availabilityNote="Need a ride"
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText('Availability is not open for this event.')).toBeTruthy();
    expect(screen.getByLabelText('Availability note')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Going' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: "Can't go" })).toBeDisabled();
  });
});

describe('AvailabilityNotesList', () => {
  it('renders nothing when notes are hidden or empty', () => {
    const { rerender, container } = render(<AvailabilityNotesList event={buildEvent()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<AvailabilityNotesList event={buildEvent({ availabilityNotesVisible: true, availabilityNotes: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders shared availability notes when visible', () => {
    render(
      <AvailabilityNotesList
        event={buildEvent({
          availabilityNotesVisible: true,
          availabilityNotes: [{ displayName: 'Sam Lee', response: 'maybe', note: 'Need pickup after warmups.' }]
        })}
      />
    );

    expect(screen.getByText('Availability notes')).toBeTruthy();
    expect(screen.getByText('Sam Lee')).toBeTruthy();
    expect(screen.getByText('Maybe')).toBeTruthy();
    expect(screen.getByText('Need pickup after warmups.')).toBeTruthy();
  });
});

describe('AttentionPanel', () => {
  it('renders the empty state when no actions need attention', () => {
    render(<AttentionPanel items={[]} onSelectSection={vi.fn()} />);

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('No parent actions need attention right now.')).toBeTruthy();
  });

  it('renders primary and secondary actions and routes callbacks by section', () => {
    const onSelectSection = vi.fn();
    const items: AttentionPanelItem[] = [
      { title: 'Bring snacks', detail: 'Two snack slots are still open.', section: 'assignments' },
      { title: 'Ride request', detail: 'Need a ride home.', section: 'rideshare' }
    ];

    render(<AttentionPanel items={items} onSelectSection={onSelectSection} />);

    expect(screen.getByText('Needs attention')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Bring snacks.*Go/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ride request' }));

    expect(onSelectSection).toHaveBeenNthCalledWith(1, 'assignments');
    expect(onSelectSection).toHaveBeenNthCalledWith(2, 'rideshare');
  });
});
