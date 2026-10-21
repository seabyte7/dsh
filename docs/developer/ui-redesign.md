# UI-only changes

English | [中文](ui-redesign.zh.md)

Desktop and Web share one interface. For UI-only tasks, change presentation and preserve Harness behavior. These limits do not authorize work beyond the user's request.

## Allowed directories

Only presentation changes are allowed in these locations. Relevant locale dictionaries, tests, and README files may accompany them.

| Purpose | Directory |
|---|---|
| Theme styles | `packages/client/ui-theme/src/styles/` |
| Shared controls | `packages/client/ui-primitives/src/` |
| Application layout | `packages/client/ui-layout/src/client/` |
| Left navigation | `packages/client/ui-sidebar/src/client/` |
| Workspace and Session rows | `packages/client/ui-workspace/src/client/rows/` |
| Chat presentation | `packages/client/ui-chat/src/client/chat/` |
| Conversation and composer layout | `packages/client/ui-conversation/src/client/skeleton/` |
| Tool cards | `packages/client/ui-tool/src/client/tool/components/` |
| Right sidebar frame | `packages/client/ui-sidebar-right/src/client/shell/` |

## Excluded directories and logic

All other code is excluded by default. In particular, do not change the following for a UI-only task unless the user explicitly authorizes that scope.

| Area | Excluded paths or logic |
|---|---|
| Harness and Host services | All other `packages/` groups, including `core/`, `api/`, `llm/`, `session/`, `host/`, `boot/`, and `bundle/` |
| Client infrastructure | `packages/client/connection/`, `modules/`, `web/`, `store/`, `ui-renderer/`, and `ui-slots/` |
| Desktop and Web launch | `apps/desktop/`, `apps/desktop-host/`, and `apps/web/` |
| Behavior inside UI packages | Host entries, input state machines, submission/upload logic, event assembly, business models, RPC calls, and permission checks |
| Configuration and generated files | Profiles, Cordis configuration, dependencies, lockfiles, build configuration, public exports, and generated outputs |

## Editing rules

- An allowed directory is not permission to change every file or function inside it. Keep action callbacks, request arguments, availability checks, and timing unchanged.
- Do not add automatic send, retry, or approval, or change Session events, model inputs, or stored formats.
- Reuse existing components, Slots, theme tokens, and locale dictionaries. Do not duplicate the interface for Desktop.
- If a requested visual change needs excluded code, explain the required scope change before editing it. Do not expand scope on your own.

Follow [Client rules](../../packages/client/AGENTS.md) and [Web styling](../web-styling.md) for implementation details. Use the existing [testing policy](../testing.md) for verification.
