---
description: "Open fresh side chats beside a conversation and retain each tab’s independent history."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-side-chat

English | [中文](README.zh.md)

## Summary

Ask questions beside a conversation while its main task continues. Each explicit opening starts an empty side chat; the first question creates its Session. Switching tabs or restoring the same tab keeps its history. Closing a tab does not stop its answer or delete saved history. The panel accepts text questions and displays whether the source snapshot was cropped.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose Side chat from the right Sidebar guide or the conversation header, enter a question, then send it with Enter or the Send button. Follow-up questions use that tab’s history; opening Side chat again starts a separate empty history. Stop affects the side chat; closing the tab only releases its browser view. The existing right Sidebar owns pane placement, resizing, and narrow-screen presentation.

This plugin mounts as a `cordis.yml` row and has no configuration fields. Its composition requires the [side-chat Host](../../session/side-chat/README.md), Conversation, Session UI, resources, locale, and right-Sidebar services. Missing Remote registration prevents the feature from activating.

The panel shows lookup failures beside retained history and offers Retry loading. Archived or deleted targets remain unavailable instead of creating replacement histories. A failed first-question handoff keeps the question; an existing target draft is preserved and must be sent or cleared before retrying the handoff.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A `dsh-resource://sidechat/session/<source>/request/<id>` address identifies each tab. Opening allocates only this identity; lookup and creation use the same id. Resources, drafts, pending submissions, and errors are address-scoped. Reconnection restores that exact association; delayed results from another tab cannot replace it. Legacy source-only addresses retain their original association.

The first question uses the Host association service, retains an independent submission reference, and requests draft initialization on that exact Session binding. Only an applied initialization enters the ordinary input machine; a preserved or blocked draft is never submitted by the handoff. The submission reference lasts until the existing input admission and pending echoes settle. An independently bound SessionProvider renders the public Conversation Factory with its embedded variant and fixed Chat view.

The committed side-chat projection identifies question Sessions before their first snapshot and reports the actual source position and cropping afterward. The embedded Conversation uses its shared text-only input Factory, including the main composer keymap, busy-Enter preference, and target-scoped Stop action. A registered input policy preserves text-only input when a question Session opens in the main conversation area. The first question uses the same Factory with a feature-owned draft before a target Session exists. Commands, attachments, model selection, and preset controls are unavailable.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These references describe the services and presentation reused here.

- [Side-chat Host](../../session/side-chat/README.md) — association, snapshot preparation, and question policy.
- [Conversation](../ui-conversation/README.md) — existing input admission and embedded content.
- [Right Sidebar](../ui-sidebar-right/README.md) — tab layout and restoration.
- [Client resources](../../../docs/subsystems/client-resources.md) — shared resource ownership.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents browser-side side chats and registers nothing model-facing.

#### KV Cache effect

None; the Host and ordinary Session input own the submitted question and source snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The question composer intentionally exposes only supported question actions.

- Questions beginning with `/` are rejected with a visible field notice and remain as drafts; slash commands are unsupported.
- Retained or dropped attachments block submission and remain until the user selects Remove attachments; the question text is preserved.
- Unsent tab drafts survive view remounts within the current browser process; this package does not promise persistence across browser restarts.
- The panel reports a bounded text snapshot, not live synchronization with the main task or inherited file and image content.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
