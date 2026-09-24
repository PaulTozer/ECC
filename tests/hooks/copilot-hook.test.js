'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateHook } = require('../../scripts/lib/copilot/hook');
const script = path.resolve(__dirname, '..', '..', 'scripts', 'copilot-hook.js');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}\n${error.stack}`);
    failed++;
  }
}

test('CLI camelCase payload produces native denial without running commands', () => {
  const result = evaluateHook({ toolName: 'powershell', toolArgs: { command: 'git commit --no-verify' } });
  assert.strictEqual(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /must not be bypassed/);
  assert.strictEqual(result.hookSpecificOutput, undefined);
});

test('CLI serialized toolArgs are normalized', () => {
  const result = evaluateHook({ toolName: 'bash', toolArgs: JSON.stringify({ command: 'git push --no-verify' }) });
  assert.strictEqual(result.permissionDecision, 'deny');
});

test('VS Code snake_case payload produces nested denial', () => {
  const result = evaluateHook({ tool_name: 'run_in_terminal', tool_input: { command: 'git commit -n' } });
  assert.strictEqual(result.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(result.hookSpecificOutput.permissionDecision, 'deny');
});

test('Claude-compatible names and function-prefixed CLI tools are supported', () => {
  for (const name of ['Bash', 'functions.powershell', 'execute', 'terminal/ runInTerminal']) {
    const result = evaluateHook({ tool_name: name, tool_input: { command: 'git push --no-verify' } });
    assert.strictEqual(result.hookSpecificOutput.permissionDecision, 'deny');
  }
});

test('benign commands and non-shell tools do not pre-approve execution', () => {
  assert.deepStrictEqual(evaluateHook({ toolName: 'powershell', toolArgs: { command: 'git status' } }), {});
  assert.deepStrictEqual(evaluateHook({ toolName: 'view', toolArgs: { file: 'git commit --no-verify' } }), {});
});

test('malformed payloads and shell arguments fail closed', () => {
  for (const input of [null, [], {}, { toolName: 4 }, { toolName: 'bash', toolArgs: 'invalid' },
    { toolName: 'bash', toolArgs: {} }, { toolName: 'bash', toolArgs: { command: 1 } }]) {
    assert.throws(() => evaluateHook(input));
  }
});

test('stdin runner returns one JSON object for CLI and VS Code', () => {
  for (const payload of [
    { toolName: 'powershell', toolArgs: { command: 'git push --no-verify' } },
    { tool_name: 'run_in_terminal', tool_input: { command: 'git push --no-verify' } },
  ]) {
    const result = spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual((output.hookSpecificOutput || output).permissionDecision, 'deny');
  }
});

test('invalid or oversized stdin denies in both protocols without logging input', () => {
  for (const input of ['sensitive invalid payload', 'x'.repeat(1024 * 1024 + 1)]) {
    const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    assert.strictEqual(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.permissionDecision, 'deny');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(!result.stderr.includes('sensitive'));
  }
});

console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
