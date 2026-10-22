---
kind: upgrade-guide
description: "使用 Agent Teams 装配包时显式允许自定义根预设。"
---

# Agent Teams 根预设

[English](guide.md) | 中文

## 变更

Agent Teams 装配包允许 `standard`、`cordis`、`ptc` 预设和无预设的根会话参与 Team。其他预设（包括纯文本侧聊）不获得 Team 工具或提示词。使用自定义 Team 根预设的安装需要显式声明这些预设 ID。

## 迁移

1. 在所用配置的 `cordis.patch.yml` 中，为 `agent-team` 行加入 `rootAgentPresets`，列出所有支持的预设 ID，包括仍需使用的内置预设。
2. 保留装配包[完整配置行](../../../../packages/experimental/agent-team-profile/cordis.patch.yml)中的其他字段，因为补丁会替换该行的整个配置。
3. 重启 Host，确认普通自定义预设聊天可使用 `spawn_teammate`，侧聊仍可在没有 Team 工具的情况下回答。
