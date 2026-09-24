#!/usr/bin/env node
'use strict';

const HELP = `Usage: node scripts/copilot-package.js --output <new-directory> [--dry-run] [--with-memory] [--with-hooks]

Build a self-contained native Copilot plugin outside the source checkout.
Restored production Node dependencies are bundled; no downloads or installs run.
Existing destinations are never overwritten. No user settings are changed.

--with-memory  Include the local ECC Memory Vault MCP server (project/team only).
--with-hooks   Enable the git hook-bypass guard, not the Claude hook suite.
--dry-run      Validate and report the package without writing files.

Install the result with: copilot plugin install <output-directory>
See docs/COPILOT.md for VS Code setup, limitations, updates and removal.
`;

if (require.main === module) {
  try {
    if (process.argv.includes('--help')) {
      process.stdout.write(HELP);
    } else {
      const { buildPlugin, parseArgs } = require('./lib/copilot/package');
      console.log(JSON.stringify(buildPlugin(parseArgs(process.argv.slice(2))), null, 2));
    }
  } catch (error) {
    console.error(`Copilot package failed: ${error.message}`);
    process.exitCode = 1;
  }
}
