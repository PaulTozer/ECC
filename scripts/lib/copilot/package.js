'use strict';

const fs = require('fs');
const path = require('path');
const { isWithinRoot } = require('../path-safety');
const { adaptAgent, adaptSkill } = require('./markdown');
const { runtimeFiles } = require('./files');

const NAMESPACE = 'com.github.copilot';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

function parseArgs(args) {
  const initial = { dryRun: false, withMemory: false, withHooks: false };
  const options = args.reduce((state, arg, index) => {
    if (index > 0 && args[index - 1] === '--output') return state;
    if (arg === '--help') return { ...state, help: true };
    if (arg === '--dry-run') return { ...state, dryRun: true };
    if (arg === '--with-memory') return { ...state, withMemory: true };
    if (arg === '--with-hooks') return { ...state, withHooks: true };
    if (arg !== '--output') throw new Error(`Unknown option: ${arg}`);
    if (state.output || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Specify --output exactly once with a new directory');
    }
    return { ...state, output: args[index + 1] };
  }, initial);
  if (!options.help && !options.output) throw new Error('--output <new-directory> is required');
  return options;
}

function nativeFiles(version, { withMemory, withHooks }) {
  const manifest = {
    $schema: PLUGIN_SCHEMA, name: 'ecc', version, license: 'MIT',
    description: 'ECC skills, native Copilot agents and opt-in local utilities.',
  };
  const hooks = {
    version: 1,
    hooks: { preToolUse: [{
      type: 'command',
      bash: 'node "${PLUGIN_ROOT}/scripts/copilot-hook.js"',
      powershell: 'node "${PLUGIN_ROOT}/scripts/copilot-hook.js"',
      timeoutSec: 10,
    }] },
  };
  const mcp = {
    $schema: MCP_SCHEMA,
    mcpServers: { 'ecc-memory': {
      type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/scripts/memory-mcp.mjs'],
      env: { ECC_MEMORY_HARNESS: 'copilot', ECC_MEMORY_ALLOW_USER_SCOPE: '0' },
    } },
  };
  return [
    { relative: 'plugin.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    ...(withMemory ? [{ relative: 'mcp.json', content: JSON.stringify(mcp, null, 2) + '\n' }] : []),
    ...(withHooks ? [{ relative: path.join(NAMESPACE, 'hooks', 'hooks.json'), content: JSON.stringify(hooks, null, 2) + '\n' }] : []),
  ];
}

function adaptFiles(files) {
  return files.flatMap(file => {
    const parts = file.relative.split(path.sep);
    if (parts.length === 3 && parts[0] === 'skills' && parts[2] === 'SKILL.md') {
      return [{ relative: file.relative, content: adaptSkill(fs.readFileSync(file.source, 'utf8'), parts[1]) }];
    }
    if (parts.length === 2 && parts[0] === 'agents' && parts[1].endsWith('.md')) {
      const name = path.basename(parts[1], '.md');
      return [file, {
        relative: path.join(NAMESPACE, 'agents', `ecc-${name}.agent.md`),
        content: adaptAgent(fs.readFileSync(file.source, 'utf8'), name),
      }];
    }
    return [file];
  });
}

function buildPlugin(options) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..', '..', '..'));
  if (!options.output || typeof options.output !== 'string') throw new Error('An output directory is required');
  const output = path.resolve(options.output);
  if (isWithinRoot(output, sourceRoot)) throw new Error('Plugin output must be outside the source checkout');
  if (fs.existsSync(output)) throw new Error('Plugin output already exists; choose a new directory');
  const { manifest, files } = runtimeFiles(sourceRoot);
  const adapted = adaptFiles(files);
  const operations = [...adapted, ...nativeFiles(manifest.version, options)];
  const result = {
    output, version: manifest.version, dryRun: Boolean(options.dryRun),
    skills: adapted.filter(file => file.relative.startsWith(`skills${path.sep}`) && path.basename(file.relative) === 'SKILL.md').length,
    agents: adapted.filter(file => file.relative.startsWith(`${NAMESPACE}${path.sep}agents${path.sep}`)).length,
    files: operations.length, memory: Boolean(options.withMemory), hooks: Boolean(options.withHooks),
  };
  if (options.dryRun) return result;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output);
  // Publish the manifest last: an interrupted copy must not look like a ready plugin.
  for (const file of operations.filter(file => file.relative !== 'plugin.json')) {
    writeFile(output, file);
  }
  writeFile(output, operations.find(file => file.relative === 'plugin.json'));
  return result;
}

function writeFile(output, file) {
  const destination = path.join(output, file.relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (file.content !== undefined) fs.writeFileSync(destination, file.content, { flag: 'wx' });
  else fs.copyFileSync(file.source, destination, fs.constants.COPYFILE_EXCL);
}

module.exports = { buildPlugin, parseArgs };
