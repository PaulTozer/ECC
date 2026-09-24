# Native local GitHub Copilot integration

ECC can run as a local **Agent Plugins 1.0** package in recent Copilot CLI,
Copilot app and VS Code versions. The older instruction/prompt-only Copilot
description does not describe these clients' current capabilities.

## What is included

| Surface | Local implementation |
| --- | --- |
| Skills | All canonical `skills/*/SKILL.md` files, with their supporting files; loaded on demand |
| Custom agents | All canonical agents, converted to `.agent.md` and named `ecc-<name>` |
| Utilities | Bundled Node scripts, manifests, schemas, rules and production dependencies |
| Memory | Optional existing ECC Memory Vault stdio MCP server; no new remote service |
| Hooks | Optional native pre-tool guard using ECC's existing Git hook-bypass detector |
| Existing prompts | `.github/prompts/` remains available in VS Code Local; not installed as CLI commands |

The package preserves upstream workflow bodies, but removes Claude-specific
model selection, skill permission pre-approvals and unsupported frontmatter.
Agent tool restrictions are translated to Copilot aliases; unrecognized tools
fail the build instead of accidentally granting all tools. Agent definitions
request repository instructions in CLI subagents. Five imported scientific
skills currently have names different from their directories; the generated
copies use their directory names for native discovery.

This is **not full Claude runtime emulation**. Claude session persistence,
automatic instinct learning, auto-formatting, transcript observers and tmux
orchestration are not enabled. Skills describing those features are guidance,
not proof that an equivalent Copilot runtime is available. External MCP
servers, credentials, language runtimes, Bash, Python and tmux must be
configured separately when a workflow needs them. No external MCP catalog or
placeholder credentials are installed.

## Build a local package

Prerequisites: Node 18 or newer, a current Copilot client, and restored ECC
dependencies. From an ECC checkout on Windows:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
$plugin = Join-Path $env:USERPROFILE ".copilot\ecc-local\release-1"
node scripts\copilot-package.js --output $plugin --dry-run
node scripts\copilot-package.js --output $plugin --with-memory --with-hooks
```

The output must be a **new directory outside the checkout**. The builder never
overwrites an existing destination or edits personal client configuration.
It copies production Node dependencies already installed in the checkout;
it does not download dependencies, run package install scripts or change PATH.
The output is independent of the checkout, so archiving a worktree does not
break an installed package. Keep its `LICENSE` when redistributing it.

Omit `--with-memory` and/or `--with-hooks` to leave those automatic components
out. Both are disabled by default. The builder reports the actual component
counts and writes the plugin manifest last, after all other files are copied.
An interrupted build should be inspected and rebuilt to a new directory.

## Install in Copilot CLI and the app

```powershell
copilot plugin install $plugin
copilot plugin list
copilot skill list
copilot mcp list
```

For a nonpersistent preview, use:

```powershell
copilot --plugin-dir $plugin
```

Start a new session after installation. In the agent picker, select
`ecc-planner`, `ecc-tdd-guide`, or another ECC agent. Skills are exposed through
the client's skill picker/slash menu; clients can namespace plugin skills,
for example `ecc:tdd-workflow`. Use the names the picker actually displays.
Project or personal skills with the same name can take precedence over plugin
copies; installation does not overwrite them.

Some CLI versions warn that direct installs will be deprecated. They currently
accept local paths; a local marketplace is the migration path if a future
version requires `plugin@marketplace` installation.

The Copilot app has a **Customize > Plugins** surface. Confirm that `ecc` is
enabled there after starting a new session. Client versions can differ in
whether CLI-installed plugins are shared automatically; CLI discovery alone
does not prove that an already running app session has refreshed.

## VS Code

Recent VS Code versions discover CLI-installed plugins automatically. Ensure
the user setting `chat.plugins.enabled` is enabled, reload the window when
convenient, and check **Configure Skills**, the agent picker and the MCP list.

Alternatively, register the built directory explicitly in your **user**
`settings.json`, preserving all existing settings:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "C:\\path\\to\\ecc-local\\release-1": true
  }
}
```

Prefer one discovery route rather than registering two copies. VS Code Agent
Host uses Copilot's hook implementation. VS Code Local accepts the versioned
CLI hook configuration but supplies a different runtime payload; the bundled
adapter handles both formats. MCP tools and custom agents remain subject to
the client's normal trust and permission prompts. Do not disable those gates.

## Local memory and utility use

With `--with-memory`, the `ecc-memory` server exposes `memory_save`,
`memory_search`, `memory_read` and `memory_doctor`. It uses Node and the bundled
runtime, with `ECC_MEMORY_HARNESS=copilot`. There is no API key requirement.

The server inherits the target project's working directory, not the plugin
directory. Project/team memory is stored under that project's `.ecc/memory/`.
User-scope memory access is explicitly disabled. Memory is saved only when a
tool is invoked: the integration does not record or import raw transcripts.
Recalled content remains untrusted evidence, never executable instructions.
Avoid setting global `ECC_MEMORY_PROJECT_ROOT` overrides unless a shared vault
is intentional.

To use utilities without configuring MCP:

```powershell
node "$plugin\scripts\ecc.js" memory --help
node "$plugin\scripts\ecc.js" memory doctor
node "$plugin\scripts\ecc.js" catalog --help
```

Run from the project whose state you intend to inspect. Commands requiring
another harness's configuration or a separate executable still require it.
This packaging path does not add a `--target copilot` to the existing ECC
installer and does not register Copilot in ECC's unrelated harness registry.

The optional guard examines shell-tool input and blocks recognized Git
hook-bypass flags. It never executes the proposed command, never implicitly
approves a tool, and never logs the input. Malformed/oversized inputs produce
explicit denials. This detector is a workflow backstop, **not a shell sandbox**;
Copilot's own permission controls remain authoritative. CLI hook timeouts may
fail open; the guard does not promise a stronger client-level guarantee.

## Updates and removal

Build to a fresh versioned directory, then reinstall it using the native
plugin command. Direct installs may be cached; editing the old source directory
does not necessarily refresh the installed plugin. Restart the relevant
session after updating.

```powershell
copilot plugin disable ecc
# Or remove the plugin registration:
copilot plugin uninstall ecc
```

If VS Code uses an explicit `chat.pluginLocations` entry, disable or remove
that entry separately. Unregistering the plugin should not remove project
memories; manage those deliberately as project data.

## Official compatibility references

- [GitHub plugin authoring](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Copilot plugin schema and discovery](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Copilot hook contracts](https://docs.github.com/en/copilot/reference/hooks-reference)
- [VS Code agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [VS Code hooks](https://code.visualstudio.com/docs/agent-customization/hooks)
