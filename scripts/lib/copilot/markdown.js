'use strict';

const yaml = require('js-yaml');

const TOOL_NAMES = Object.freeze({
  Read: 'read', Grep: 'search', Glob: 'search',
  Write: 'edit', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'execute', WebFetch: 'web', WebSearch: 'web',
  Task: 'agent', TodoWrite: 'todo',
});

const COPILOT_CONTEXT = [
  '## Copilot compatibility',
  '',
  'Use native Copilot tools and permissions. Claude model names, tool names,',
  'plugin commands and home-directory paths in the upstream examples are not',
  'Copilot configuration. Use read/search/edit/execute/agent equivalents;',
  'ECC custom agents have the `ecc-` name prefix. Do not install another harness',
  'or grant permissions merely because an example mentions it.',
  '',
  'Supporting files are bundled with this plugin. Resolve relative paths from',
  'this document, not from the project being edited. The plugin root contains',
  '`scripts/ecc.js`: run it with Node from the target project directory for',
  'ECC utilities (for example, `node <plugin-root>/scripts/ecc.js memory --help`).',
  'Do not assume `ecc` is on PATH. External MCP services, language toolchains,',
  'Python, Bash/tmux and API credentials are separate prerequisites; report',
  'missing prerequisites instead of pretending the workflow ran.',
  '',
  'Memory is opt-in: use the ecc-memory MCP tools when configured, or the',
  'bundled memory CLI. Never import transcripts or secrets automatically.',
  'Keep PR review routing with the repository-approved reviewers.',
  '',
].join('\n');

function parseMarkdown(source, name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(`Invalid Copilot component name: ${name}`);
  }
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${name}`);
  const fields = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error(`Frontmatter must be an object: ${name}`);
  }
  if (typeof fields.description !== 'string' || !fields.description.trim() || fields.description.length > 1024) {
    throw new Error(`Invalid description for ${name}`);
  }
  return { fields, body: normalized.slice(match[0].length) };
}

function serialize(fields, body) {
  return `---\n${yaml.dump(fields, { lineWidth: -1, noRefs: true }).trimEnd()}\n---\n\n${COPILOT_CONTEXT}\n${body}`;
}

function mapTool(tool) {
  if (typeof tool !== 'string') throw new Error('Unsupported Copilot agent tool type');
  const name = tool.trim();
  if (Object.hasOwn(TOOL_NAMES, name)) return TOOL_NAMES[name];
  const mcp = name.match(/^mcp__([a-zA-Z0-9_-]+)__([a-zA-Z0-9_-]+)$/);
  if (mcp) return `${mcp[1]}/${mcp[2]}`;
  throw new Error(`Unsupported Copilot agent tool: ${name}`);
}

function adaptAgent(source, name) {
  const { fields, body } = parseMarkdown(source, name);
  if (!Array.isArray(fields.tools) && typeof fields.tools !== 'string') {
    throw new Error(`Missing or invalid agent tools: ${name}`);
  }
  const tools = Array.isArray(fields.tools) ? fields.tools : fields.tools.split(',');
  return serialize({
    name: `ecc-${name}`,
    description: fields.description,
    tools: [...new Set(tools.map(mapTool))],
    'include-custom-instructions': true,
  }, body);
}

function adaptSkill(source, name) {
  const { fields, body } = parseMarkdown(source, name);
  const optional = ['argument-hint', 'user-invocable', 'disable-model-invocation', 'metadata'];
  for (const key of ['user-invocable', 'disable-model-invocation']) {
    if (Object.hasOwn(fields, key) && typeof fields[key] !== 'boolean') {
      throw new Error(`${key} must be boolean: ${name}`);
    }
  }
  return serialize({
    name,
    description: fields.description,
    ...Object.fromEntries(optional.filter(key => Object.hasOwn(fields, key)).map(key => [key, fields[key]])),
  }, body);
}

module.exports = { adaptAgent, adaptSkill };
