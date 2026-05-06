import { describe, expect, it } from 'vitest';
import {
    buildOfficiatingAssignmentNotificationRecords,
    buildOfficiatingNotificationRecord
} from '../../js/officiating-notifications.js';

describe('officiating notification records', () => {
    it('builds assigned records with assignment type, game reference, status, timestamp, and actor', () => {
        const timestamp = new Date('2026-05-05T13:00:00Z');
        const [record] = buildOfficiatingAssignmentNotificationRecords({
            teamId: 'team-1',
            gameId: 'game-1',
            nextGame: {
                id: 'game-1',
                opponent: 'Sharks',
                location: 'Field 2',
                date: new Date('2026-05-06T20:00:00Z'),
                officiatingSlots: [
                    { id: 'slot-1', position: 'Referee', officialEmail: 'REF@example.com', status: 'pending' }
                ]
            },
            actor: { uid: 'assigner-1', displayName: 'Assignor', email: 'assignor@example.com' },
            timestamp
        });

        expect(record).toMatchObject({
            type: 'officiating_assignment',
            assignmentType: 'Referee',
            event: 'assigned',
            gameId: 'game-1',
            slotId: 'slot-1',
            position: 'Referee',
            status: 'pending',
            timestamp,
            actorUserId: 'assigner-1',
            actorEmail: 'assignor@example.com',
            recipientType: 'official',
            recipientOfficialEmail: 'ref@example.com',
            read: false
        });
        expect(record.gameReference).toMatchObject({
            teamId: 'team-1',
            gameId: 'game-1',
            opponent: 'Sharks',
            location: 'Field 2'
        });
    });

    it('creates rescheduled records for unchanged officials when the game schedule changes', () => {
        const records = buildOfficiatingAssignmentNotificationRecords({
            teamId: 'team-1',
            gameId: 'game-1',
            previousGame: {
                date: new Date('2026-05-06T20:00:00Z'),
                location: 'Field 2',
                officiatingSlots: [
                    { id: 'slot-1', position: 'Umpire', officialUserId: 'official-1', status: 'accepted' }
                ]
            },
            nextGame: {
                date: new Date('2026-05-06T20:00:00Z'),
                location: 'Field 3',
                officiatingSlots: [
                    { id: 'slot-1', position: 'Umpire', officialUserId: 'official-1', status: 'accepted' }
                ]
            }
        });

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            event: 'rescheduled',
            assignmentType: 'Umpire',
            status: 'accepted',
            recipientOfficialUserId: 'official-1'
        });
    });

    it('builds decline and self-assignment records for assigner audit visibility', () => {
        const declined = buildOfficiatingNotificationRecord({
            teamId: 'team-1',
            gameId: 'game-1',
            game: { opponent: 'Lions' },
            slot: { id: 'slot-1', position: 'Line Judge', officialEmail: 'line@example.com', status: 'declined' },
            event: 'declined',
            status: 'declined',
            recipientType: 'assigner',
            actor: { uid: 'official-1', email: 'line@example.com' }
        });

        const selfAssigned = buildOfficiatingNotificationRecord({
            teamId: 'team-1',
            gameId: 'game-2',
            slot: { id: 'slot-2', position: 'Referee', officialUserId: 'official-2', status: 'accepted' },
            event: 'self_assigned',
            recipientType: 'assigner',
            actor: { uid: 'official-2' }
        });

        expect(declined).toMatchObject({ event: 'declined', status: 'declined', recipientType: 'assigner', actorUserId: 'official-1' });
        expect(selfAssigned).toMatchObject({ event: 'self_assigned', status: 'accepted', recipientType: 'assigner', actorUserId: 'official-2' });
    });
});
