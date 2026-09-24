#!/usr/bin/env node
'use strict';

const { evaluateHook, invalidDenial } = require('./lib/copilot/hook');
const MAX_BYTES = 1024 * 1024;
let chunks = [];
let bytes = 0;
let inputFailed = false;

process.stdin.on('data', chunk => {
  bytes += chunk.length;
  if (bytes <= MAX_BYTES) chunks = [...chunks, chunk];
});
process.stdin.on('error', () => {
  inputFailed = true;
  finish();
});
process.stdin.on('end', finish);

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  try {
    if (inputFailed || bytes > MAX_BYTES) throw new Error('Invalid input stream');
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(JSON.stringify(evaluateHook(payload)) + '\n');
  } catch {
    process.stderr.write('ECC Copilot hook: invalid or oversized input; denying tool execution.\n');
    process.stdout.write(JSON.stringify(invalidDenial()) + '\n');
    process.exitCode = 2;
  }
}
