---
kind: upgrade-guide
description: "Use a stable request id to restore each independently opened side chat."
---

# Side-chat identities

English | [中文](guide.zh.md)

## Change

Opening Side chat from the header or Sidebar guide starts an empty chat. Switching or restoring the same tab preserves its history. Existing saved Sessions and source-only tab addresses remain readable.

`sideChat.ensure` reuses a target for the same source and `requestId`; a different id creates a separate history. Source-only `sideChat.lookup` reads the legacy association, not the most recently opened chat.

## Migration

1. Remote consumers retain one `requestId` per side chat and pass it to both `lookup` and `ensure`, including retries and restoration.
2. Allocate a different id only for an explicit new chat. Keep the source and id in its tab address.
3. Rebuild Host and Client together. Verify that a new chat has no old messages, draft, or error, while restoring an existing tab retains its own history.

No Session-log or association-record migration is required; existing history is preserved.
