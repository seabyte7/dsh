---
description: "Configure independent owner-only side-chat Sessions, durable source associations, fixed model routing, and the first text reference snapshot."
kind: "package-reference"
---

# @deepseek-ai/dsh-side-chat

English | [中文](README.zh.md)

## Summary

Ask independent questions about one conversation while its main task continues. The first accepted question adds a bounded text reference snapshot to a separate ordinary Session; follow-ups reuse that committed context. Each stable creation id has one durable target; a new id starts another history for the same source. The configured question preset has no tools and uses a fixed model route. This feature serves the trusted owner of a personal installation.

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

Use the optional [side-chat bundle](../../bundle/side-chat/README.md) for the complete Host, Client, and question-preset composition. This package mounts through Cordis rows; its `./client` entry contributes the generated `sideChat` Remote namespace only when enabled.

### Configuration

The Host requires the ordinary Session, Agent, preset, reference, projection, persistence, storage-domain, workspace, and access services. Its required policy fields select the question preset and fixed model route:

```yaml
- name: '@deepseek-ai/dsh-side-chat'
  config:
    agentPreset: side-chat-question
    provider: deepseek-official
    model: deepseek-flash
```

| Field | Default | Meaning |
|---|---|---|
| `agentPreset` | required | Preset containing `@deepseek-ai/dsh-side-chat/question` and native tool presentation |
| `provider` | required | Provider route for every side-chat request |
| `model` | required | Provider-owned question model identity |

The question entry belongs inside the preset. A missing initializer or a final Agent-specific tool schema set that is not empty rejects creation or execution. The fixed provider and model apply after prompt assembly and request routing, including cold restoration; reasoning effort follows that route’s provider default. The [configuration catalog](../../../docs/config-catalog.md) owns the accepted field definitions.

### Association and first input

Opening a panel uses `sideChat.lookup` with its source and stable `requestId`, creating nothing. `sideChat.ensure` returns the same target for retries of that pair; a different id creates an independent history. Source-only lookup retains the legacy association and never selects the latest chat. It never submits a prompt. The Client sends questions and stops responses through the existing target Session APIs. Caller cancellation before allocation stops admission; once allocation is durable, creation remains Host-owned.

The first direct text question prepares the source through `session-reference` at its actual pre-step cut. A canonical mention of that same source reuses the existing preparation. Source and target lifecycle checks precede reference resolution; other Session references and non-text attachments reject before source preparation. After the first reference commits, later questions cannot refresh it with another canonical mention. The `sideChat` projection exposes `{ snapshot: null }` before initialization and snapshot metadata afterward; ordinary Sessions expose `null`.

### Access, failures, and recovery

Remote methods read the trusted invocation identity and accept only the owner. They declare the source Session resource and explicitly check discovered target Session and workspace resources through existing access services. Background initialization rejects principal-bearing non-owner input and rechecks source lifecycle state; it does not treat invocation-free `allows()` as non-owner authorization. Shared-session and non-owner support are outside this package.

Deleted, archived, migration-required, nested, mismatched, or misconfigured Sessions produce typed failures. A missing ready target is never replaced. Failed initialization leaves no committed source snapshot and requires explicit user retry; model-request retries and later turns keep the committed reference. An uncertain prompt response remains the ordinary Session API’s responsibility and is not automatically resubmitted.

Closing a panel releases Client view resources. Disabling the Host first closes admission, cancels and drains question Agents, then releases its creation handles and storage domain. Controller-restored handles remain Controller-owned; Agent-local denial and tool restrictions prevent later execution after this plugin unloads. Main Agents and persisted question history remain independent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `side_chat` storage domain records source and target identities, the creation request, the preset, the working directory, and `allocated` / `created` / `ready` phases. The source-serialized Host coordinator persists an allocation before creating that exact Session, flushes Session state, and commits readiness afterward. The first allocation retains the legacy source key; later chats use source-and-request keys in the same validated table. Record fields and existing keys remain readable. Recovery can adopt a matching Session created before its phase write; it cannot allocate a replacement for a missing committed target. This coordination supports one writing Host.

The scoped initializer registers its preset generation with the Host. Each associated Agent receives its own admission listeners, an inherited-tool restriction, and a monotonic executor guard. A global creation listener also rejects mapped cold targets whose preset lost the initializer. Snapshot metadata folds from the existing committed `user/message` reference source, so restoration uses projection reads rather than private persistence-file scans.

| File | Owns |
|---|---|
| [`src/index.ts`](src/index.ts) | Remote API, allocation, admission, and owned-resource teardown |
| [`src/question.ts`](src/question.ts) | Scoped initializer entry |
| [`src/storage.ts`](src/storage.ts) | Validated association records |
| [`src/projection.ts`](src/projection.ts) | Source-cut and omission metadata |
| [`src/client/index.ts`](src/client/index.ts) | Optional generated Remote contribution |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session references](../../context/session-reference/README.md) — text retention and omission details.
- [Agent presets](../../preset/agent-preset-registry/README.md) — declared composition and cold restoration.
- [Storage domains](../../storage/storage-domain/README.md) — validated business records and durability.
- [Side-chat Client](../../client/ui-side-chat/README.md) — panel and input behavior.

-----

<a id="model-experience"></a>
## Model Experience

### Independent question context

#### What the model sees

The independent Session contains the user’s question plus an untrusted, read-only `session-reference` text snapshot from the source. Source user and assistant text and supported compaction checkpoints follow the reference service’s retention policy. Raw tool results, reasoning, binary attachments, and uncommitted streaming fragments are not inherited. The main conversation receives no side-chat input or events.

#### Token effect

The first side-chat request pays for its bounded source snapshot and question; later requests reuse that Session history. The configured reference service owns the byte budget and omission notices. The association and projection metadata add no model tokens, and no additional summarization request runs.

#### KV Cache effect

The side chat has its own request history and cache prefix. Its first committed reference stays stable as the source changes, so follow-ups do not replace that prefix. The main conversation’s reconstructed request history is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the supported personal-use feature.

- One side chat per source and one writing Host; no shared-user authorization or multiple-target selection.
- Context is the reference service’s bounded text snapshot, not the source model’s complete current request.
- Question Sessions remain ordinary visible Sessions. The plugin does not hide them from the conversation list or add nested side chats.
- The optional preset must remain available for continuation. Removing it preserves readable history but prevents execution.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The focused Loader tests live in [`tests/side-chat.spec.ts`](tests/side-chat.spec.ts). Supported-profile composition, recorded model input, and browser acceptance belong to the optional bundle and its Client.

</details>
