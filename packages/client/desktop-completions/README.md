---
description: "Keep macOS Dock completion counts synchronized with unread Session results and main Conversation viewing."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-desktop-completions

English | [中文](README.zh.md)

## Summary

Use this package in Desktop to keep the macOS Dock count and sidebar completion reminders consistent. Results remain unread while the window is hidden or unfocused, including when their Conversation stays selected. Opening a focused main Conversation acknowledges only its loaded results. Other desktop platforms and ordinary browsers retain their existing reminder behavior.

## Table of Contents

- [Completion reminders](#completion-reminders)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="completion-reminders"></a>
## Completion reminders

The shipped Desktop profile loads this plugin. Its macOS preload supplies complete unread snapshots; a browser without that API performs no native operations. The [Desktop application](../../../apps/desktop/README.md#closing-the-window-and-quitting) owns native counting, completion classification, focus checks, and reset behavior.

The adapter registers the shell snapshot as the [Session UI](../ui-session/README.md) completion source. It reports the latest loaded turn boundary only when that Session is the retained main Conversation, its history is open, and no global main panel replaces it. Retaining a Session for a sidebar, or retaining the main Session while another panel is shown, acknowledges nothing. The shell additionally requires a visible, focused, non-minimized window; an old loaded position cannot acknowledge a newer completion.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell owns unread membership across renderer reloads. The Client subscribes before requesting its baseline and rejects older snapshot revisions. Main-Session history is observed through the Controller's existing event window, using its incremental changes after the initial opening. Disposal detaches every source and settles submitted IPC before releasing the main viewing position. Failed native reads or acknowledgements report diagnostics and retain the latest unread snapshot.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this plugin registers no model-facing tools or prompt content.

#### KV Cache effect

None; native unread state does not enter model requests or Session events.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Unread results last for the current Desktop process and reset when its Host is replaced; application restart does not replay historical completion notifications.
- Viewing acknowledgement means the completed turn is loaded in the active main Conversation; it does not track whether the user scrolled to each individual message.
- Native completion badges are macOS-only. System banners and notification-click navigation are separate capabilities.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
