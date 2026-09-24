'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { adaptAgent, adaptSkill } = require('../../scripts/lib/copilot/markdown');
const { buildPlugin, parseArgs } = require('../../scripts/lib/copilot/package');
const { collectFiles } = require('../../scripts/lib/copilot/files');

const repoRoot = path.resolve(__dirname, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-package-'));
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

function frontmatter(source) {
  return yaml.load(source.match(/^---\n([\s\S]*?)\n---/)[1]);
}

function agent(fields = '') {
  return `---\nname: planner\ndescription: Plan changes\ntools: Read, Grep, Glob\nmodel: opus\n${fields}---\nKeep the original workflow.\n`;
}

try {
  test('agents preserve restrictions, inherit instructions, and omit model overrides', () => {
    const result = adaptAgent(agent(), 'planner');
    assert.deepStrictEqual(frontmatter(result), {
      name: 'ecc-planner',
      description: 'Plan changes',
      tools: ['read', 'search'],
      'include-custom-instructions': true,
    });
    assert.ok(result.includes('Keep the original workflow.'));
    assert.ok(result.includes('Copilot'));
  });

  test('agent tool mapping supports writes, execution, web, delegation and MCP names', () => {
    const source = agent().replace('Read, Grep, Glob',
      'Read, Write, Edit, Bash, WebFetch, WebSearch, Task, TodoWrite, mcp__context7__query-docs');
    assert.deepStrictEqual(frontmatter(adaptAgent(source, 'planner')).tools,
      ['read', 'edit', 'execute', 'web', 'agent', 'todo', 'context7/query-docs']);
  });

  test('agent conversion rejects unknown tools instead of broadening permissions', () => {
    assert.throws(() => adaptAgent(agent().replace('Read, Grep, Glob', 'UnknownTool'), 'planner'),
      /Unsupported.*tool/);
    assert.deepStrictEqual(frontmatter(adaptAgent(agent().replace('Read, Grep, Glob', '[]'), 'planner')).tools, []);
  });

  test('skills normalize directory names and remove harness-specific permissions and models', () => {
    const source = '\uFEFF---\r\nname: old-name\r\ndescription: "Use: this skill"\r\n'
      + 'allowed-tools: Bash(*)\r\nmodel: opus\r\ncontext: fork\r\nagent: planner\r\n'
      + 'disable-model-invocation: true\r\nuser-invocable: false\r\n'
      + 'metadata:\r\n  origin: ECC\r\n---\r\nOriginal instructions.\r\n';
    const result = adaptSkill(source, 'new-name');
    assert.deepStrictEqual(frontmatter(result), {
      name: 'new-name',
      description: 'Use: this skill',
      'disable-model-invocation': true,
      'user-invocable': false,
      metadata: { origin: 'ECC' },
    });
    assert.ok(result.includes('Original instructions.'));
  });

  test('malformed metadata and unsafe identifiers fail explicitly', () => {
    for (const source of ['No frontmatter', '---\n- array\n---\nbody',
      '---\nname: x\ndescription: []\n---\nbody',
      '---\nname: x\ndescription: one\ndescription: two\n---\nbody']) {
      assert.throws(() => adaptSkill(source, 'safe-name'));
    }
    assert.throws(() => adaptSkill(agent(), '../escape'), /name/);
    assert.throws(() => adaptSkill(agent(), 'a'.repeat(65)), /name/);
    assert.throws(() => adaptSkill(agent().replace('Plan changes', 'x'.repeat(1025)), 'valid'), /description/);
    assert.throws(() => adaptSkill(agent('user-invocable: maybe\n'), 'valid'), /boolean/);
    assert.throws(() => adaptAgent(agent().replace('tools: Read, Grep, Glob\n', ''), 'planner'), /tools/);
  });

  test('argument parser requires explicit output and opt-in runtime activation', () => {
    assert.deepStrictEqual(parseArgs(['--output', root, '--dry-run']),
      { output: root, dryRun: true, withMemory: false, withHooks: false });
    assert.strictEqual(parseArgs(['--output', root, '--with-memory', '--with-hooks']).withHooks, true);
    assert.strictEqual(parseArgs(['--help']).help, true);
    for (const args of [[], ['--output'], ['--output', '--with-memory'], ['--force'], ['--output', root, '--output', root]]) {
      assert.throws(() => parseArgs(args));
    }
  });

  test('dry run inventories every canonical skill without creating output', () => {
    const output = path.join(root, 'preview');
    const result = buildPlugin({ sourceRoot: repoRoot, output, dryRun: true });
    const expected = fs.readdirSync(path.join(repoRoot, 'skills'))
      .filter(name => fs.existsSync(path.join(repoRoot, 'skills', name, 'SKILL.md')));
    assert.strictEqual(result.skills, expected.length);
    assert.strictEqual(result.agents, fs.readdirSync(path.join(repoRoot, 'agents')).filter(name => name.endsWith('.md')).length);
    assert.strictEqual(fs.existsSync(output), false);
  });

  test('package output cannot overwrite an existing directory or live inside source', () => {
    assert.throws(() => buildPlugin({ sourceRoot: repoRoot, output: root }), /exists/);
    assert.throws(() => buildPlugin({ sourceRoot: repoRoot, output: path.join(repoRoot, 'dist', 'copilot') }), /source/);
  });

  test('file collection excludes credentials and caches and rejects directory links', () => {
    const fixture = path.join(root, 'files');
    fs.mkdirSync(path.join(fixture, 'node_modules'), { recursive: true });
    for (const name of ['keep.txt', '.env', '.env.local', 'server.key', 'secrets.json']) {
      fs.writeFileSync(path.join(fixture, name), 'fixture');
    }
    assert.deepStrictEqual(collectFiles(fixture).map(file => file.relative), ['keep.txt']);
    const linked = path.join(root, 'linked');
    fs.symlinkSync(fixture, linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => collectFiles(linked), /symbolic link/);
    fs.symlinkSync(fixture, path.join(fixture, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => collectFiles(fixture), /symbolic link/);
  });

  test('default package contains native skills and agents without automatic hooks or MCP', () => {
    const output = path.join(root, 'default');
    const result = buildPlugin({ sourceRoot: repoRoot, output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.name, 'ecc');
    assert.strictEqual(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    assert.strictEqual(fs.existsSync(path.join(output, 'mcp.json')), false);
    assert.strictEqual(fs.existsSync(path.join(output, 'com.github.copilot', 'hooks', 'hooks.json')), false);
    assert.strictEqual(fs.existsSync(path.join(output, '.mcp.json')), false);
    assert.ok(result.skills >= 292);
    assert.ok(fs.existsSync(path.join(output, 'skills', 'frontend-slides', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(output, 'com.github.copilot', 'agents', 'ecc-planner.agent.md')));
    assert.ok(fs.readFileSync(path.join(output, 'LICENSE'), 'utf8').includes('MIT'));
    assert.strictEqual(fs.existsSync(path.join(output, 'node_modules', 'eslint')), false);
    assert.ok(fs.existsSync(path.join(output, 'node_modules', 'ajv', 'package.json')));
    const help = spawnSync(process.execPath, [path.join(output, 'scripts', 'ecc.js'), 'memory', '--help'],
      { cwd: root, encoding: 'utf8' });
    assert.strictEqual(help.status, 0, help.stderr);
  });

  test('opt-in package emits portable MCP and hook definitions using the project working directory', () => {
    const output = path.join(root, 'enabled');
    buildPlugin({ sourceRoot: repoRoot, output, withMemory: true, withHooks: true });
    const config = JSON.parse(fs.readFileSync(path.join(output, 'mcp.json'), 'utf8'));
    const server = config.mcpServers['ecc-memory'];
    assert.strictEqual(server.command, 'node');
    assert.deepStrictEqual(server.args, ['${PLUGIN_ROOT}/scripts/memory-mcp.mjs']);
    assert.strictEqual(server.env.ECC_MEMORY_HARNESS, 'copilot');
    assert.strictEqual(server.env.ECC_MEMORY_ALLOW_USER_SCOPE, '0');
    assert.strictEqual(server.cwd, undefined, 'Never bind project memory to the plugin directory');
    const hooks = JSON.parse(fs.readFileSync(path.join(output, 'com.github.copilot', 'hooks', 'hooks.json'), 'utf8'));
    assert.strictEqual(hooks.version, 1);
    assert.strictEqual(hooks.hooks.preToolUse.length, 1);
    assert.ok(hooks.hooks.preToolUse[0].powershell.includes('copilot-hook.js'));
    assert.ok(hooks.hooks.preToolUse[0].bash.includes('copilot-hook.js'));

    const project = path.join(root, 'memory-project');
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ecc-test', version: '1.0.0' },
      } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'memory_save', arguments: { title: 'Copilot package smoke', body: 'Verified local package fixture.' },
      } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'memory_search', arguments: { query: 'Copilot package smoke' },
      } },
    ];
    const response = spawnSync(process.execPath, [path.join(output, 'scripts', 'memory-mcp.mjs')], {
      cwd: project, encoding: 'utf8', timeout: 15000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ECC_MEMORY_'))),
        ...server.env, HOME: root, USERPROFILE: root },
      input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
    });
    assert.strictEqual(response.status, 0, response.stderr);
    const replies = response.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.strictEqual(replies.length, 4);
    assert.deepStrictEqual(replies.find(reply => reply.id === 2).result.tools.map(tool => tool.name),
      ['memory_save', 'memory_search', 'memory_read', 'memory_doctor']);
    for (const id of [3, 4]) {
      const reply = replies.find(item => item.id === id);
      assert.ok(reply.result && !reply.result.isError, JSON.stringify(reply));
      assert.match(reply.result.content[0].text, /Copilot package smoke/);
    }
    assert.ok(fs.existsSync(path.join(project, '.ecc', 'memory', 'project', '.gitignore')));
    assert.strictEqual(fs.existsSync(path.join(output, '.ecc')), false);
  });

  test('CLI reports input failures with a nonzero exit', () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'copilot-package.js'), '--unknown'],
      { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Unknown/);
  });

  test('CLI help is available without installing or creating a plugin', () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'copilot-package.js'), '--help'],
      { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /--with-memory/);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
