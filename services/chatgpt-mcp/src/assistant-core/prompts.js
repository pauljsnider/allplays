// Shared planner and final-answer prompts for the AllPlays assistant.
//
// Extracted verbatim from apps/app/src/lib/privateAiService.ts so the in-app AI
// chat and the ChatGPT MCP service reason with identical instructions and the
// same AVAILABLE TOOLS block (sourced from ./registry.js). Pure string building,
// no platform dependency.

import { TOOL_REGISTRY, renderAvailableTools } from './registry.js';

export function summarizeSignedInUser(user) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles || [],
    emailVerified: user.emailVerified === true
  };
}

export function formatToolResultsForPrompt(toolResults) {
  return (toolResults || []).map((result) => ({
    name: result.name,
    ok: result.ok,
    data: result.data,
    error: result.error,
    requiresConfirmation: result.requiresConfirmation === true
  }));
}

export function buildPlannerPrompt({ user, question, history, toolResults }, registry = TOOL_REGISTRY) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `You may answer from conversation context for general navigation. For account-specific facts, request tools first.\n` +
    `Use only the available tools; never ask for or invent Firestore paths.\n` +
    `Return strict JSON only, with no markdown.\n` +
    `If you need data, return {"toolCalls":[{"name":"list_schedule","args":{"range":"upcoming","limit":8}}]}.\n` +
    `For last/previous game questions, call get_last_game. For game-specific questions, do not answer with practices as substitutes.\n` +
    `For writes, call the write tool with normalized args. The app will stage it and require user confirmation before execution.\n` +
    `If you have enough information, return {"answer":"..."}.\n\n` +
    `AVAILABLE TOOLS:\n` +
    renderAvailableTools(registry) + `\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS SO FAR:\n${JSON.stringify(formatToolResultsForPrompt(toolResults))}\n`;
}

export function buildFinalAnswerPrompt({ user, question, history, toolResults }) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `Use ONLY this account-scoped data. If the data is missing, say what is missing.\n` +
    `For product/how-to questions, use help documentation results and include the relevant help page when useful.\n` +
    `If a tool result requires confirmation, state the proposed change clearly and tell the user they can reply "yes" to confirm. Do not mention internal confirmation IDs or codes.\n` +
    `When the user asks for a game, answer from game records only; if only practices are available, say no matching game was found.\n` +
    `Answer concisely. Include dates, times, team names, and player names when relevant.\n` +
    `Return strict JSON only: {"answer":"..."}.\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS:\n${JSON.stringify(formatToolResultsForPrompt(toolResults))}\n`;
}
