import { describe, expect, it } from 'vitest';

import { updateOfficiatingSlotResult } from '../../js/officiating-utils.js';

describe('updateOfficiatingSlotResult', () => {
    const acceptedSlot = {
        id: 'slot-1',
        position: 'Referee',
        officialUserId: 'official-1',
        officialEmail: 'official@example.com',
        officialName: 'Alex Official',
        status: 'accepted'
    };

    it('stores final score attribution for the accepted assigned official', () => {
        const slots = updateOfficiatingSlotResult([
            acceptedSlot
        ], 'slot-1', {
            homeScore: 42,
            awayScore: 35,
            notes: 'Close finish'
        }, {
            uid: 'official-1',
            email: 'official@example.com',
            displayName: 'Alex Official'
        }, {
            submittedAt: '2026-06-02T09:30:00.000Z'
        });

        expect(slots[0].submittedResult).toEqual({
            homeScore: 42,
            awayScore: 35,
            notes: 'Close finish',
            submittedAt: '2026-06-02T09:30:00.000Z',
            submittedByUserId: 'official-1',
            submittedByEmail: 'official@example.com',
            submittedByName: 'Alex Official'
        });
    });

    it('rejects non-accepted assignments from submitting results', () => {
        expect(() => updateOfficiatingSlotResult([
            { ...acceptedSlot, status: 'pending' }
        ], 'slot-1', {
            homeScore: 42,
            awayScore: 35
        }, {
            uid: 'official-1',
            email: 'official@example.com'
        })).toThrow('Only accepted assignments can submit final results.');
    });

    it('rejects other officials from submitting results for the slot', () => {
        expect(() => updateOfficiatingSlotResult([
            acceptedSlot
        ], 'slot-1', {
            homeScore: 42,
            awayScore: 35
        }, {
            uid: 'official-2',
            email: 'other@example.com'
        })).toThrow('You can only submit a result for your own accepted assignment.');
    });
});
