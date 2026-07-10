// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParentScheduleEvent } from '../../apps/app/src/lib/scheduleLogic';
import {
  AttentionPanel,
  AvailabilityNotesList,
  QuickAvailabilityPanel,
  ReadOnlyAvailabilityPanel,
  TeamRsvpToolsDisclosure,
  getAvailabilityNoteSaveState,
  type AttentionItem
} from '../../apps/app/src/components/schedule/AvailabilityPanels';

afterEach(() => {
  cleanup();
});

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'event-1',
    id: 'event-1',
    teamId: 'team-1',
    teamName: 'Tigers',
    type: 'practice',
    date: new Date('2026-06-20T18:00:00.000Z'),
    location: 'North Field',
    childId: 'child-1',
    childName: 'Avery Smith',
    isDbGame: false,
    isCancelled: false,
    assignments: [],
    availabilityNotesVisible: false,
    availabilityNotes: [],
    ...overrides
  };
}

describe('availability schedule panels', () => {
  it.each([
    [
      'cancelled',
      { isDbGame: true, isCancelled: true },
      'This event was cancelled, so availability can no longer be changed.'
    ],
    [
      'untracked',
      { isDbGame: false, isCancelled: false },
      'This event is not tracked in the team schedule, so availability is unavailable.'
    ],
    [
      'locked',
      { isDbGame: true, availabilityLocked: true, availabilityCutoffLabel: '2 hours before the event' },
      'The team availability cutoff (2 hours before the event) has passed, so responses can no longer be changed.'
    ]
  ])('renders %s availability as saved read-only context without form controls', (_state, overrides, explanation) => {
    render(
      <ReadOnlyAvailabilityPanel
        event={buildEvent({ ...overrides, myRsvpNote: 'Arriving after halftime' })}
        rsvp="maybe"
      />
    );

    expect(screen.getByText('Availability unavailable')).toBeTruthy();
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(screen.getByText('Current response for Avery Smith')).toBeTruthy();
    expect(screen.getByText('Maybe')).toBeTruthy();
    expect(screen.getByText('Saved note')).toBeTruthy();
    expect(screen.getByText('Arriving after halftime')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('labels a closed event with no saved RSVP as no response instead of requesting action', () => {
    render(<ReadOnlyAvailabilityPanel event={buildEvent()} rsvp="not_responded" />);

    expect(screen.getByText('No response recorded')).toBeTruthy();
    expect(screen.queryByText('RSVP needed')).toBeNull();
  });

  it('keeps team RSVP tools collapsed until staff opens the disclosure', () => {
    render(
      <TeamRsvpToolsDisclosure summary={{ going: 3, maybe: 1, notGoing: 0, notResponded: 2, total: 6 }}>
        <div>Staff-only RSVP action</div>
      </TeamRsvpToolsDisclosure>
    );

    const disclosure = screen.getByRole('button', { name: /Team RSVP tools.*3 going.*2 missing/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Staff-only RSVP action')).toBeNull();

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Staff-only RSVP action')).toBeTruthy();
  });

  it('tracks trimmed availability note save state', () => {
    expect(getAvailabilityNoteSaveState('going', '  carpool after practice  ', 'carpool after practice')).toEqual({
      isDirty: false,
      canSaveNote: false,
      trimmedAvailabilityNote: 'carpool after practice',
      trimmedSavedAvailabilityNote: 'carpool after practice'
    });

    expect(getAvailabilityNoteSaveState('maybe', 'Needs a ride', '')).toMatchObject({
      isDirty: true,
      canSaveNote: true
    });

    expect(getAvailabilityNoteSaveState('not_responded', 'Needs a ride', '')).toMatchObject({
      isDirty: true,
      canSaveNote: false
    });
  });

  it('renders a dirty saved RSVP note and submits the current RSVP when saving the note', () => {
    const onAvailabilityNoteChange = vi.fn();
    const onSubmit = vi.fn(() => Promise.resolve());

    render(
      <QuickAvailabilityPanel
        event={buildEvent({ myRsvpNote: 'Arriving at 5:00', availabilityNotesVisible: true })}
        rsvp="going"
        canSubmitRsvp
        submitting={null}
        availabilityNote="Arriving at 5:15"
        onAvailabilityNoteChange={onAvailabilityNoteChange}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Unsaved note changes')).toBeTruthy();
    expect(screen.getByText('Team note sharing is on for this team.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Availability note'), { target: { value: 'Arriving after school' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(onAvailabilityNoteChange).toHaveBeenCalledWith('Arriving after school');
    expect(onSubmit).toHaveBeenCalledWith('going');
  });

  it('renders needed and locked availability states without changing async behavior', () => {
    const onSubmit = vi.fn(() => Promise.resolve());

    const { rerender } = render(
      <QuickAvailabilityPanel
        event={buildEvent()}
        rsvp="not_responded"
        canSubmitRsvp
        submitting={null}
        availabilityNote=""
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Availability needed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    expect(onSubmit).toHaveBeenCalledWith('going');

    rerender(
      <QuickAvailabilityPanel
        event={buildEvent()}
        rsvp="maybe"
        canSubmitRsvp={false}
        submitting={null}
        availabilityNote=""
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Availability is not open for this event.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Going' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders no availability notes when sharing is hidden or the list is empty', () => {
    const { container, rerender } = render(
      <AvailabilityNotesList
        event={buildEvent({
          availabilityNotesVisible: false,
          availabilityNotes: [{ displayName: 'Avery', response: 'going', note: 'Can drive.' }]
        })}
      />
    );

    expect(container.firstChild).toBeNull();

    rerender(<AvailabilityNotesList event={buildEvent({ availabilityNotesVisible: true, availabilityNotes: [] })} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders shared availability notes with normalized RSVP badges', () => {
    render(
      <AvailabilityNotesList
        event={buildEvent({
          availabilityNotesVisible: true,
          availabilityNotes: [
            { displayName: 'Avery', response: 'going', note: 'Can drive two players.' },
            { displayName: 'Jordan', response: 'not_going', note: 'Out of town.' }
          ]
        })}
      />
    );

    expect(screen.getByText('Availability notes')).toBeTruthy();
    expect(screen.getByText('Avery')).toBeTruthy();
    expect(screen.getByText('Can drive two players.')).toBeTruthy();
    expect(screen.getByText('Jordan')).toBeTruthy();
    expect(screen.getByText("Can't go")).toBeTruthy();
  });

  it('renders caught-up attention state and routes attention item clicks', () => {
    const onSelectSection = vi.fn();
    const items: AttentionItem[] = [
      { title: 'Claim snack duty', detail: 'One assignment still needs a helper.', section: 'assignments' },
      { title: 'Ride request waiting', detail: 'Someone needs a seat.', section: 'rideshare' }
    ];

    const { rerender } = render(<AttentionPanel items={[]} onSelectSection={onSelectSection} />);

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('No parent actions need attention right now.')).toBeTruthy();

    rerender(<AttentionPanel items={items} onSelectSection={onSelectSection} />);

    expect(screen.getByText('Needs attention')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Claim snack duty/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ride request waiting' }));

    expect(onSelectSection).toHaveBeenNthCalledWith(1, 'assignments');
    expect(onSelectSection).toHaveBeenNthCalledWith(2, 'rideshare');
  });
});
