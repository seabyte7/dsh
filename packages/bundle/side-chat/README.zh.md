---
description: "用于 Web 和 Desktop 配置的可选个人问答侧栏，使用独立会话与固定来源文本快照。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-side-chat-bundle

[English](README.md) | 中文

## 概述

在右侧栏提问时，原任务继续执行。这个可选层为每个来源聊天关联一个独立问答会话，使用固定文本快照和无工具 preset。新建 Desktop 配置默认启用它，Web 配置默认关闭。它依赖既有 Web 服务和可信 owner 身份。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 启用或关闭侧聊

Desktop 新安装默认启用侧聊，可在 App 的“插件”页打开或关闭；已有配置在升级时保留原选择。Web 开发仍将 patch 作为附加层：

```sh
pnpm dsh web --patch packages/bundle/side-chat/cordis.patch.yml --no-open
```

patch 装配 Host 服务、对应 Client 适配器、右侧问答界面和 `side-chat-question` preset。移除该层后，已保存的聊天仍可阅读；继续提问需要原 preset 和 Host 服务。

### 问答与模型策略

从聊天头部打开“侧聊”。打开空面板不会创建会话；提交首问时才创建关联会话并截取来源文本。追问继续使用已经提交的快照。关闭面板只释放视图，回答继续执行。

`side-chat` 条目明确选择 `deepseek-official` / `deepseek-flash`。后续 patch 可用 `agentPreset`、`provider`、`model` 替换该条目的完整 config；自定义 preset 必须保留问答初始化插件和原生工具呈现，且不包含工具。上下文预算仍由既有引用服务管理。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[patch](cordis.patch.yml) 组合 [Host 关联服务](../../session/side-chat/README.zh.md)、[Client 面板](../../client/ui-side-chat/README.zh.md)和独立 preset。`@deepseek-ai/dsh-side-chat/question` 入口为每个问答 Agent 安装来源初始化与执行限制。persona 说明固定快照及文件、执行能力的限制。所有条目均沿用默认 preset、主 Agent 循环和既有会话权限策略。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [装配包索引](../README.zh.md) — 其他配置层。
- [架构](../../../docs/architecture.zh.md) — 配置分层。
- [开发与验收](../../../docs/discussion/side-chat-plugin-plan.md) — 范围、验证证据和剩余验收工作。

-----

<a id="model-experience"></a>
## 模型体验

本装配包通过[侧聊初始化插件](../../session/side-chat/README.zh.md#model-experience)和 [patch](cordis.patch.yml) 中的问答 persona 间接提供模型上下文。

#### KV 缓存影响

每个问答会话拥有独立的请求历史；后续问题继续使用已经提交的固定来源快照。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 支持单 Host 与其可信 owner，不扩展共享用户权限。
- 快照包含预算内的聊天文本，不含工具原始结果、图片内容或当前文件，也不会自动同步。
- 问答仅接受纯文本，不提供斜杠命令和附件。
- 真实模型与浏览器验收依赖各自环境，本地组合测试不能代替这些结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
