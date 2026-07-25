export type SharedPrivateAiUser = {
    uid: string;
    email?: string;
    displayName?: string;
    roles?: string[];
    emailVerified?: boolean;
};

export class SharedPrivateAiToolError extends Error {
    code: string;
    constructor(code: string, message: string);
}

export type SharedPrivateAiToolDefinition = {
    name: string;
    mode: 'read';
    description: string;
    aliases?: string[];
    parameters?: Record<string, 'string' | 'number' | 'boolean'>;
    resolve: (user: SharedPrivateAiUser, args?: Record<string, unknown>) => Promise<unknown>;
};

export type SharedPrivateAiReadAdapter = {
    now?: () => Date;
    loadProfile: (user: SharedPrivateAiUser) => Promise<Record<string, unknown>>;
    loadSchedule: (
        user: SharedPrivateAiUser,
        options: { includePastGames: boolean; args: Record<string, unknown> }
    ) => Promise<Record<string, any>>;
    loadScheduleEventDetail?: (user: SharedPrivateAiUser, event: any) => Promise<Record<string, any> | null>;
    loadRideOffers?: (user: SharedPrivateAiUser, event: any) => Promise<any[]>;
    loadAssignments?: (user: SharedPrivateAiUser, event: any) => Promise<any[]>;
    loadPracticePacket?: (
        user: SharedPrivateAiUser,
        event: any,
        schedule: Record<string, any>
    ) => Promise<Record<string, any> | null>;
};

export const SHARED_PRIVATE_AI_READ_TOOL_CATALOG: ReadonlyArray<Omit<SharedPrivateAiToolDefinition, 'resolve'>>;
export function getSharedPrivateAiReadToolDefinition(name: string): Omit<SharedPrivateAiToolDefinition, 'resolve'> | null;
export function createSharedPrivateAiReadToolDefinitions(adapter: SharedPrivateAiReadAdapter): SharedPrivateAiToolDefinition[];
export function pickPrivateAiFields(source: Record<string, any>, fields: string[]): Record<string, any>;
export function summarizeSharedProfile(user: SharedPrivateAiUser, model?: Record<string, any>): Record<string, any>;
export function summarizeSharedScheduleEvent(event: any): Record<string, any>;
export function summarizeSharedAssignment(assignment: any): Record<string, any>;
export function summarizeSharedRideOffer(offer: any): Record<string, any>;
export function summarizeSharedPracticePacket(packet: any): Record<string, any>;
export function summarizeSharedSchedule(
    schedule: Record<string, any>,
    args?: Record<string, unknown>,
    options?: { now?: Date }
): Record<string, any>;
export function summarizeSharedLastGame(
    schedule: Record<string, any>,
    args?: Record<string, unknown>,
    options?: { now?: Date }
): Record<string, any>;
export function findSharedScheduleEvent(schedule: Record<string, any>, args?: Record<string, unknown>): any | null;
