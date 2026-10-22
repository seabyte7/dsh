---
kind: upgrade-guide
description: "Allow custom root presets explicitly when using the Agent Teams profile bundle."
---

# Agent Teams root presets

English | [中文](guide.zh.md)

## Change

The Agent Teams profile bundle enables Team membership for the `standard`, `cordis`, and `ptc` presets and for preset-free roots. Other presets, including text-only side chats, receive no Team tools or prompts. Installations using custom Team root presets must declare those preset ids.

## Migration

1. Add `rootAgentPresets` to the `agent-team` row in your profile’s `cordis.patch.yml`. Include every supported preset id, including the shipped ids you still use.
2. Retain the other fields from the bundle’s [complete row](../../../../packages/experimental/agent-team-profile/cordis.patch.yml), since a patch replaces the row’s entire configuration.
3. Restart the Host and verify that an ordinary custom-preset conversation exposes `spawn_teammate`, while side chat still answers without Team tools.
