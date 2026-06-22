import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const firestoreTypesSource = readSource('apps/app/src/lib/firestore/types.ts');
const firestoreMappersSource = readSource('apps/app/src/lib/firestore/mappers.ts');
const chatServiceSource = readSource('apps/app/src/lib/chatService.ts');
const scheduleServiceSource = readSource('apps/app/src/lib/scheduleService.ts');
const gameReportServiceSource = readSource('apps/app/src/lib/gameReportService.ts');

describe('app Firestore boundary initiative source contract', () => {
    it('keeps native Firestore REST decoding centralized in shared types and mappers', () => {
        expect(firestoreTypesSource).toContain('export type FirestoreValue = FirestoreScalarValue & FirestoreArrayValue & FirestoreMapValue;');
        expect(firestoreTypesSource).toContain('export type FirestoreDocument = {');
        expect(firestoreTypesSource).toContain('export type FirestoreDecodedDocument = Record<string, unknown> & {');

        expect(firestoreMappersSource).toContain('function decodeFirestoreValue(value: FirestoreValue | undefined): unknown');
        expect(firestoreMappersSource).toContain('export function decodeFirestoreFields(fields: Record<string, FirestoreValue> = {}): Record<string, unknown>');
        expect(firestoreMappersSource).toContain('export function mapFirestoreDocument(document: FirestoreDocument | null | undefined): FirestoreDecodedDocument | null');
        expect(firestoreMappersSource).toContain('if (value && typeof (value as { toDate?: unknown }).toDate === \'function\')');
        expect(firestoreMappersSource).toContain('if (value && typeof (value as { seconds?: unknown }).seconds === \'number\')');
    });

    it('keeps chat Firestore records and native REST reads behind shared mappers', () => {
        expect(firestoreTypesSource).toContain('export type ChatConversationFirestoreRecord = {');
        expect(firestoreTypesSource).toContain('export type ChatMessageFirestoreRecord = {');
        expect(firestoreMappersSource).toContain('export function mapChatConversationRecord(value: unknown, fallbackId = \'\'): ChatConversationFirestoreRecord | null');
        expect(firestoreMappersSource).toContain('export function mapChatMessageRecord(value: unknown, fallbackId = \'\'): ChatMessageFirestoreRecord | null');

        expect(chatServiceSource).toContain("} from './firestore/mappers';");
        expect(chatServiceSource).toContain('export type ChatConversation = ChatConversationFirestoreRecord;');
        expect(chatServiceSource).toContain('export type ChatMessage = ChatMessageFirestoreRecord;');
        expect(chatServiceSource).toContain('return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument);');
        expect(chatServiceSource).toContain('return mapChatMessageRecord(message, message?.id || \'\') || null;');
        expect(chatServiceSource).toContain('const mappedMessages = mapChatMessageRecords(messages);');
    });

    it('keeps schedule event records normalized before page/service logic consumes them', () => {
        expect(firestoreTypesSource).toContain('export type ScheduleEventFirestoreRecord = {');
        expect(firestoreMappersSource).toContain('export function mapScheduleEventRecord(value: unknown, fallbackId = \'\'): ScheduleEventFirestoreRecord | null');
        expect(firestoreMappersSource).toContain('export function mapScheduleEventDocument(document: FirestoreDocument | null | undefined): ScheduleEventFirestoreRecord | null');
        expect(firestoreMappersSource).toContain('export function mapScheduleEventDocuments(documents: FirestoreDocument[] | null | undefined): ScheduleEventFirestoreRecord[]');

        expect(scheduleServiceSource).toContain("import { mapFirestoreDocument, mapScheduleEventDocument, mapScheduleEventDocuments, mapScheduleEventRecord, mapScheduleEventRecords } from './firestore/mappers';");
        expect(scheduleServiceSource).toContain('import type { FirestoreDecodedDocument, FirestoreDocument as NativeFirestoreDocument } from \'./firestore/types\';');
        expect(scheduleServiceSource).toContain('return mapScheduleEventDocument(await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument);');
        expect(scheduleServiceSource).toContain('async () => mapScheduleEventRecords(await getGames(teamId, range))');
        expect(scheduleServiceSource).toContain('async () => mapScheduleEventRecord(await getGame(teamId, gameId), gameId)');
    });

    it('keeps game report Firestore records typed and mapped before report assembly', () => {
        expect(firestoreTypesSource).toContain('export type GameReportGameFirestoreRecord = {');
        expect(firestoreTypesSource).toContain('export type GameReportAggregatedStatsFirestoreRecord = {');
        expect(firestoreTypesSource).toContain('export type GameReportEventFirestoreRecord = {');
        expect(firestoreMappersSource).toContain('export function mapGameReportGameRecord(value: unknown, fallbackGameId = \'\'): GameReportGameFirestoreRecord');
        expect(firestoreMappersSource).toContain('export function mapGameReportAggregatedStatsRecord(id: string, value: unknown): GameReportAggregatedStatsFirestoreRecord');
        expect(firestoreMappersSource).toContain('export function mapGameReportEventRecords(value: unknown): GameReportEventFirestoreRecord[]');

        expect(gameReportServiceSource).toContain("} from './firestore/mappers';");
        expect(gameReportServiceSource).toContain("} from './firestore/types';");
        expect(gameReportServiceSource).toContain('const team = mapGameReportTeamRecord(rawTeam, teamId);');
        expect(gameReportServiceSource).toContain('const game = mapGameReportGameRecord(rawGame, gameId);');
        expect(gameReportServiceSource).toContain('const data = mapGameReportAggregatedStatsRecord(playerId, docSnap.data());');
        expect(gameReportServiceSource).toContain('const insightEvents = mapGameReportEventRecords(rawEvents)');
    });
});
