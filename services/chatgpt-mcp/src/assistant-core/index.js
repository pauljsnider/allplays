// @allplays/assistant-core — the shared tool contract and prompts for the
// AllPlays assistant, used by both the in-app AI chat (apps/app) and the
// ChatGPT MCP service (services/chatgpt-mcp). No platform or Firebase deps.
export { TOOL_REGISTRY, getToolDescriptor, toolNames, renderAvailableTools } from './registry.js';
export {
  buildPlannerPrompt,
  buildFinalAnswerPrompt,
  summarizeSignedInUser,
  formatToolResultsForPrompt
} from './prompts.js';
