# pi-minimal-subagents contributor instructions

## Product boundary

Keep the default interface small.
The extension exposes one `subagent` tool for one child task at a time.
Parallel work comes from sibling Pi tool calls rather than a second orchestration DSL.

The bundled roles are `scout`, `reviewer`, and `worker`.
Do not add roles or orchestration modes without evidence from real workflows.

## Safety

Subagents must receive explicit tool allowlists.
Custom tools must resolve from Pi's live tool registry or an explicit user mapping, never a hardcoded installation path.
Only one worker may write in a shared checkout at a time.
Scout and reviewer must not receive `edit` or `write` by default.

Children are ephemeral and fresh-context in the initial release.
Persistent sessions, nested delegation, background lifecycle management, and worktrees belong in Project Goals until deliberately designed.

## Quality

Changes require focused unit tests and a real Pi load test when extension registration changes.
Run `npm run verify` before considering work complete.
Do not weaken type checking, linting, cancellation, timeout, or output truncation to simplify an implementation.
