// Type declarations for @allplays/assistant-core (authored in plain ESM JS so
// the Node MCP service runs it directly; typed here for the TS app).

export type AssistantToolMode = 'read' | 'write';

export interface AssistantToolDescriptor {
  readonly name: string;
  readonly mode: AssistantToolMode;
  readonly aliases: readonly string[];
  readonly description: string;
}

export const TOOL_REGISTRY: readonly AssistantToolDescriptor[];
export function getToolDescriptor(name: string): AssistantToolDescriptor | null;
export function toolNames(): string[];
export function renderAvailableTools(registry?: readonly AssistantToolDescriptor[]): string;

export interface AssistantPromptUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  roles?: string[];
  emailVerified?: boolean;
}

export interface AssistantToolResultLike {
  name: string;
  ok?: boolean;
  data?: unknown;
  error?: unknown;
  requiresConfirmation?: boolean;
}

export interface AssistantPromptInput {
  user: AssistantPromptUser;
  question: string;
  history: unknown;
  toolResults: AssistantToolResultLike[];
}

export function summarizeSignedInUser(user: AssistantPromptUser): {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  roles: string[];
  emailVerified: boolean;
};
export function formatToolResultsForPrompt(toolResults: AssistantToolResultLike[]): Array<{
  name: string;
  ok?: boolean;
  data?: unknown;
  error?: unknown;
  requiresConfirmation: boolean;
}>;
export function buildPlannerPrompt(input: AssistantPromptInput, registry?: readonly AssistantToolDescriptor[]): string;
export function buildFinalAnswerPrompt(input: AssistantPromptInput): string;
