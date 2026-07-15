# pi-minimal-subagents

`pi-minimal-subagents` is a small, opinionated Pi extension for fresh, isolated subagents.
It exposes one `subagent` tool and three roles: `scout`, `reviewer`, and `worker`.

The extension keeps the simple execution model demonstrated by [amosblomqvist/pi-subagents](https://github.com/amosblomqvist/pi-subagents), while implementing the runtime independently against the current Earendil Pi APIs.
That reference repository does not currently declare a license, so its code is not copied into this package.
The official Pi subagent example and Pi extension documentation are the implementation references.

## Design

One tool call runs one child task:

```json
{
  "agent": "scout",
  "task": "Trace the authentication flow and identify the relevant tests."
}
```

Pi already executes sibling tool calls concurrently.
To fan out read-only work, the parent emits several independent `subagent` calls in the same assistant turn.
The extension does not add a second parallel or chain DSL.

Every child starts as a fresh, ephemeral Pi process without parent conversation history.
The task must therefore contain all required context, paths, decisions, constraints, and expected output.

## Agents

| Agent | Purpose | Default tools | Write policy |
|---|---|---|---|
| `scout` | Local codebase reconnaissance and context compression | `read`, `grep`, `find`, `ls`, `bash` | No `edit` or `write` |
| `reviewer` | Independent plan, code, architecture, and web review | Scout tools plus `web_search`, `fetch_content`, `get_search_content` | No `edit` or `write` |
| `worker` | Focused implementation and validation | Local write tools plus the web tools | Serialized by default |

The agent prompts are bundled in `agents/` and intentionally remain short.
Agent models, fallbacks, thinking levels, tools, disabled states, and timeouts can be overridden through settings without copying the prompt files.

## Tool discovery

Custom tools are not tied to hardcoded installation paths.
Before spawning a child, the extension reads Pi's live `pi.getAllTools()` registry and resolves the extension path recorded in each tool's `sourceInfo`.
It then launches the child with `--no-extensions`, an explicit tool allowlist, and only the extension files required by that agent.

This allows the bundled reviewer and worker to use the `fetch_content` tool from `pi-web-access` regardless of whether the package came from npm, git, or a local path.
Missing or unloadable tools fail before child startup instead of silently creating a useless agent.
For SDK-provided tools without a loadable source path, configure an explicit mapping as described below.

## Installation

Try a local checkout without installing it:

```sh
pi -e /Users/max/pi-minimal-subagents
```

Install the package from GitHub:

```sh
pi install git:github.com/max-miller1204/pi-minimal-subagents
```

The package is not published to npm yet.

## Configuration

Configuration lives under `minimalSubagents` in user or project Pi settings.
Project settings override user settings when the project is trusted.

```json
{
  "minimalSubagents": {
    "defaultModel": "opencode-go/kimi-k2.7-code",
    "fallbackModels": ["opencode-go/qwen3.7-max"],
    "allowedModels": ["opencode-go/*"],
    "defaultTimeoutMs": 900000,
    "maxConcurrency": 4,
    "maxWriterConcurrency": 1,
    "agentOverrides": {
      "scout": {
        "thinking": "medium"
      },
      "reviewer": {
        "model": "opencode-go/qwen3.7-max",
        "fallbackModels": ["opencode-go/deepseek-v4-pro"],
        "thinking": "high"
      },
      "worker": {
        "thinking": "high"
      }
    }
  }
}
```

When no model is configured, the child inherits the parent session's active provider and model.
The model is still passed explicitly to the child so another Pi session cannot change its selection through shared settings.
Fallbacks are attempted only for provider, authentication, quota, network, timeout, or model-availability failures.
Ordinary task failures do not switch models.

### Agent overrides

Each `agentOverrides.<name>` object supports:

| Field | Type | Meaning |
|---|---|---|
| `disabled` | boolean | Reject invocations of this role |
| `model` | string | Primary `provider/model`, or `inherit` |
| `fallbackModels` | string[] | Ordered provider-failure fallbacks |
| `thinking` | string | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `tools` | string[] | Complete child tool allowlist |
| `timeoutMs` | positive integer | Role-specific hard timeout |

### Explicit custom-tool mappings

Most extension tools resolve automatically from the live Pi registry.
Use `toolExtensions` only when a custom tool reports non-loadable SDK provenance:

```json
{
  "minimalSubagents": {
    "toolExtensions": {
      "my_tool": "/absolute/path/to/my-tool-extension.ts"
    }
  }
}
```

Paths may be absolute, start with `~/`, or be relative to the child working directory.

## Runtime behavior

- A process-wide semaphore limits concurrent child processes.
- A separate writer semaphore serializes worker calls in the same parent Pi process.
- Ctrl+C and tool cancellation send `SIGTERM`, followed by `SIGKILL` after a grace period.
- `timeoutMs` enforces a hard child deadline.
- Temporary prompt and task files use private permissions and are removed in `finally` blocks.
- Model-visible output is capped at Pi's standard 50 KB and 2,000-line limits.
- The collapsed TUI shows status, tool activity, the latest child message, usage, duration, and model.
- The expanded TUI shows the complete returned Markdown output.

Run `/minimal-subagents` to inspect resolved roles, models, tool allowlists, and unavailable tools.

## Security boundary

Children launch with `--no-extensions`, `--no-skills`, and `--no-prompt-templates`.
Only explicitly requested tools and their resolved extension entry points are loaded.
Nested subagents are rejected in the initial release.

The worker still has `bash`, `edit`, and `write` because it is an implementation role.
The writer semaphore prevents concurrent workers inside one parent Pi process, but it does not coordinate separate parent Pi processes.
Use one active writer per checkout until cross-process isolation or git-worktree support is deliberately implemented.

## Deliberate omissions

The initial release does not include:

- chain syntax;
- bundled workflow prompts;
- management actions;
- background run registries;
- persistent or forked child sessions;
- resume and steer;
- nested delegation;
- git-worktree orchestration;
- scheduled runs; or
- profile generation.

Larger follow-up work is tracked in `.pi/worklist.json` as Project Goals.
In particular, persistent resumable sessions are planned for tasks that cannot fit comfortably into one ephemeral child run.

## Development

```sh
npm install
npm run check
npm run pack:check
```

The test suite covers bundled agent loading, settings behavior, model allowlists, dynamic tool resolution, concurrency, cancellation, timeout handling, truncation, rendering, child JSON event parsing, and a real Pi RPC load test.

A manual end-to-end check can load both this checkout and `pi-web-access`:

```sh
pi --no-extensions \
  -e /Users/max/pi-minimal-subagents \
  -e ~/.pi/agent/npm/node_modules/pi-web-access
```

## License

MIT.
