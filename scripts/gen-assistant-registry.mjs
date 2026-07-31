#!/usr/bin/env node
// Regenerate services/chatgpt-mcp/src/assistant-core/registry.js from the app's tool registry
// (apps/app/src/lib/privateAiService.ts → privateAiToolDefinitions).
//
// The app registry stays the source of truth for tool names/modes/descriptions/
// aliases; this script lifts that CONTRACT (minus the platform resolvers) into
// the shared package so the ChatGPT MCP service and the app cannot drift.
//
// Usage: node scripts/gen-assistant-registry.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'apps/app/src/lib/privateAiService.ts');
const OUT = resolve(root, 'services/chatgpt-mcp/src/assistant-core/registry.js');

function extractTools() {
  const s = readFileSync(SRC, 'utf8');
  const decl = s.indexOf('const privateAiToolDefinitions');
  const eq = s.indexOf('=', decl);
  const arrStart = s.indexOf('[', eq);
  let depth = 0, end = -1;
  for (let i = arrStart; i < s.length; i++) {
    const c = s[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const arr = s.slice(arrStart + 1, end);

  const entries = [];
  let d = 0, cur = '';
  for (const ch of arr) {
    if (ch === '{') { if (d === 0) cur = ''; d++; }
    if (d > 0) cur += ch;
    if (ch === '}') { d--; if (d === 0) entries.push(cur); }
  }

  const tools = [];
  for (const e of entries) {
    const name = (e.match(/name:\s*'([^']+)'/) || [])[1];
    const mode = (e.match(/mode:\s*'(read|write)'/) || [])[1];
    if (!name || !mode) continue;
    const description = ((e.match(/description:\s*'((?:[^'\\]|\\.)*)'/) || [])[1] || '').replace(/\\'/g, "'");
    const aliasesRaw = (e.match(/aliases:\s*\[([^\]]*)\]/) || [])[1];
    const aliases = aliasesRaw
      ? aliasesRaw.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
      : [];
    tools.push({ name, mode, aliases, description });
  }
  return tools;
}

function esc(v) { return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function render(tools) {
  const rows = tools.map((t) => {
    const al = `[${t.aliases.map((a) => `'${esc(a)}'`).join(', ')}]`;
    return `  Object.freeze({ name: '${t.name}', mode: '${t.mode}', aliases: ${al}, description: '${esc(t.description)}' }),`;
  }).join('\n');
  return `// AUTO-GENERATED from apps/app/src/lib/privateAiService.ts (privateAiToolDefinitions).
// The shared AllPlays assistant tool CONTRACT: names, modes, descriptions, aliases.
// This is the single source of truth for both the in-app AI chat and the ChatGPT
// MCP service. Per-platform code supplies the resolver for each tool; this module
// carries no Firebase or platform dependency. Regenerate with scripts/gen-assistant-registry.mjs.

export const TOOL_REGISTRY = Object.freeze([
${rows}
]);

const byName = new Map();
for (const tool of TOOL_REGISTRY) {
  byName.set(tool.name, tool);
  for (const alias of tool.aliases) if (!byName.has(alias)) byName.set(alias, tool);
}

/** Resolve a tool descriptor by canonical name or alias; null if unknown. */
export function getToolDescriptor(name) {
  return byName.get(name) || null;
}

/** Canonical tool names in registry order. */
export function toolNames() {
  return TOOL_REGISTRY.map((tool) => tool.name);
}

/** The 'AVAILABLE TOOLS' block shared by the planner prompt across surfaces. */
export function renderAvailableTools(registry = TOOL_REGISTRY) {
  return registry.map((tool) => \`- \${tool.name} (\${tool.mode}): \${tool.description}\`).join('\\n');
}
`;
}

const tools = extractTools();
const next = render(tools);
const check = process.argv.includes('--check');
const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();

if (check) {
  if (current !== next) {
    console.error(`registry.js is stale (${tools.length} tools in source). Run: node scripts/gen-assistant-registry.mjs`);
    process.exit(1);
  }
  console.log(`assistant-core registry.js is up to date (${tools.length} tools).`);
} else {
  writeFileSync(OUT, next);
  console.log(`Wrote ${OUT} (${tools.length} tools: ${tools.filter((t) => t.mode === 'read').length} read, ${tools.filter((t) => t.mode === 'write').length} write).`);
}
