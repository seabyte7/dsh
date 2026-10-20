---
description: "Optional personal question sidebar for Web and Desktop profiles, with an independent Session and a fixed source text snapshot."
kind: "package-bundle"
---

# @deepseek-ai/dsh-side-chat-bundle

English | [中文](README.zh.md)

## Summary

Ask questions in the right sidebar while the original task continues. This optional layer adds one independent question conversation per source conversation. It uses a fixed text snapshot and a tool-free preset. New Desktop profiles enable it by default; Web profiles leave it switched off. The layer requires the existing Web services and the trusted owner identity.

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

### Enable or disable side chat

New Desktop installations enable side chat automatically. In the App’s Plugins page, switch Side chat on or off; existing profiles retain their selection through upgrades. For Web development, apply the patch as an additional layer:

```sh
pnpm dsh web --patch packages/bundle/side-chat/cordis.patch.yml --no-open
```

The patch adds the Host service, its Client adapter, the sidebar UI, and the `side-chat-question` preset. Removing the layer leaves saved conversations readable; continuing them requires their original preset and Host service.

### Question and model policy

Open **Side chat** from a conversation header. Opening the empty panel creates no Session. Submit the first question to create the associated Session and capture source text. Follow-up questions use that committed snapshot. Closing the panel releases the view; its answer continues.

The `side-chat` row explicitly selects `deepseek-official` / `deepseek-flash`. A later patch can replace its complete config with `agentPreset`, `provider`, and `model`; a custom preset must retain the question initializer and native presentation, with no tools. The existing reference service owns the context budget.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [patch](cordis.patch.yml) composes the [Host association owner](../../session/side-chat/README.md), the [Client panel](../../client/ui-side-chat/README.md), and an independent preset. The `@deepseek-ai/dsh-side-chat/question` entry attaches source initialization and execution restrictions to each question Agent. The persona describes the fixed snapshot and lack of file or execution access. No row changes the default preset, main Agent loop, or existing Session permission policy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bundle map](../README.md) — other profile layers.
- [Architecture](../../../docs/architecture.md) — profile layering.
- [Development and acceptance](../../../docs/discussion/side-chat-plugin-plan.md) — scope, verification evidence, and remaining acceptance work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [side-chat initializer](../../session/side-chat/README.md#model-experience) and the question persona in its [patch](cordis.patch.yml).

#### KV Cache effect

Each question Session has its own request history. Its committed source snapshot remains fixed for later questions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One Host and its trusted owner are supported. The layer does not add shared-user permissions.
- The snapshot contains budgeted conversation text, without raw tool results, image content, or current files; it does not automatically synchronize.
- Questions accept plain text. Slash commands and attachments are unavailable.
- Real-provider and browser acceptance require their own environment; local composition tests do not establish those results.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
