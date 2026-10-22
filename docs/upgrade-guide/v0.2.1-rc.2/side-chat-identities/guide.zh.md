---
kind: upgrade-guide
description: "使用稳定请求 id 恢复每个独立打开的侧聊。"
---

# 侧聊身份

[English](guide.md) | 中文

## 变更

从聊天头部或侧栏引导页打开“侧聊”会开始空白聊天；切换或恢复同一标签时保留其历史。已有 Session 和仅含来源的标签地址仍可读取。

`sideChat.ensure` 为相同来源与 `requestId` 复用目标，不同 id 创建独立历史。仅含来源的 `sideChat.lookup` 读取旧关联，不代表最近打开的聊天。

## 迁移

1. Remote 调用方为每个侧聊保留一个 `requestId`，在 `lookup`、`ensure`、重试和恢复时沿用它。
2. 仅在主动新开侧聊时分配新 id，并在标签地址中保存来源和该 id。
3. 一起重新构建 Host 与 Client。确认新聊天没有旧消息、草稿或错误，恢复已有标签时仍保留自身历史。

无需迁移 Session 日志或关联记录；已有历史会保留。
