'use strict';

const { run } = require('../../hooks/block-no-verify');
const SHELL_TOOLS = new Set(['bash', 'powershell', 'execute', 'run_in_terminal', 'runinterminal']);
const INVALID_REASON = 'ECC could not validate the hook input. Tool execution was not approved.';

function denial(reason, vscode = false) {
  const decision = { permissionDecision: 'deny', permissionDecisionReason: reason };
  return vscode ? { hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } } : decision;
}

function invalidDenial() {
  return { ...denial(INVALID_REASON), ...denial(INVALID_REASON, true) };
}

function evaluateHook(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid hook payload');
  const vscode = Object.hasOwn(payload, 'tool_name');
  const name = vscode ? payload.tool_name : payload.toolName;
  if (typeof name !== 'string' || !name.trim()) throw new Error('Missing tool name');
  const tool = name.split(/[./]/).at(-1).trim().toLowerCase();
  if (!SHELL_TOOLS.has(tool)) return {};
  const rawArgs = vscode ? payload.tool_input : payload.toolArgs;
  const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  if (!args || typeof args.command !== 'string') throw new Error('Missing shell command');
  const result = run(JSON.stringify({ tool_input: { command: args.command } }));
  return result.exitCode === 2 ? denial(result.stderr, vscode) : {};
}

module.exports = { evaluateHook, invalidDenial };
