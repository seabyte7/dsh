---
description: "配置独立的个人 owner 侧聊会话、持久来源关联、固定模型路由和首次文本引用快照。"
kind: "package-reference"
---

# @deepseek-ai/dsh-side-chat

[English](README.md) | 中文

## 概述

在主任务继续执行时，围绕当前聊天独立提问。首个被接受的问题把有预算限制的文本引用快照写入独立普通会话，追问沿用该已提交上下文。每个来源只有一个持久目标，并发创建请求恢复同一身份。配置的问答 preset 不提供工具，并使用固定模型路由。本功能面向个人实例的可信 owner。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过可选的[侧聊装配包](../../bundle/side-chat/README.zh.md)组合完整 Host、Client 与问答 preset。本包通过 Cordis row 挂载；启用后，`./client` 入口才注册生成的 `sideChat` Remote namespace。

### 配置

Host 依赖已有 Session、Agent、preset、引用、投影、持久化、storage-domain、工作区和访问服务。必填策略字段指定问答 preset 和固定模型路由：

```yaml
- name: '@deepseek-ai/dsh-side-chat'
  config:
    agentPreset: side-chat-question
    provider: deepseek-official
    model: deepseek-flash
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `agentPreset` | 必填 | 包含 `@deepseek-ai/dsh-side-chat/question` 与原生工具呈现的 preset |
| `provider` | 必填 | 每次侧聊请求使用的 provider 路由 |
| `model` | 必填 | provider 定义的问答模型身份 |

问答入口必须位于 preset 内。初始化插件缺失，或最终 Agent 工具 schema 集合非空时，创建或执行会被拒绝。固定 provider 和模型在提示词组装与请求路由完成后生效，冷恢复同样遵循该策略；推理强度采用该路由的 provider 默认值。[配置目录](../../../docs/config-catalog.zh.md)维护可接受字段的定义。

### 关联与首次输入

打开面板时调用 `sideChat.lookup`，不会创建会话。`sideChat.ensure` 接收带品牌的来源 Session id 和稳定请求 id，重复请求返回同一独立目标；它不发送问题。Client 使用已有目标 Session API 提问或停止回答。分配前的调用方取消会阻止准入；分配持久化后，创建操作仍由 Host 持有。

首条直接文本问题在实际 pre-step 截取点通过 `session-reference` 准备来源。问题中该来源的规范引用会复用已有准备结果。来源与目标生命周期检查先于引用解析；其他会话引用和非文本附件在准备来源前被拒绝。首次引用提交后，追问不能通过再次加入规范引用刷新快照。`sideChat` 投影在初始化前为 `{ snapshot: null }`，随后提供快照元数据；普通会话为 `null`。

### 访问、失败与恢复

Remote 方法读取可信 invocation 身份，仅接受 owner。方法声明来源 Session 资源，并通过已有访问服务显式检查发现的目标 Session 与工作区资源。后台初始化拒绝带非 owner principal 的输入，并重新检查来源生命周期；它不把无 invocation 时的 `allows()` 当作非 owner 授权。共享会话和非 owner 支持不属于本包范围。

已删除、已归档、需要迁移、嵌套、关联不匹配或配置错误的会话产生类型化失败。已就绪目标丢失时绝不创建替代。初始化失败不会提交来源快照，必须由用户显式重试；模型请求重试及后续轮次沿用已提交引用。问题提交结果未知时，继续遵循普通 Session API 的规则，不自动重新发送。

关闭面板只释放 Client 视图资源。禁用 Host 时，先关闭准入、取消并等待问答 Agent 静止，再释放自行创建的 handle 和存储 domain。Controller 冷恢复的 handle 仍归 Controller 所有；Agent 自身持有的拒绝执行规则和工具限制会阻止插件卸载后的执行。主 Agent 与已持久化问答历史保持独立。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`side_chat` 存储 domain 记录来源与目标身份、创建请求、preset、工作目录，以及 `allocated` / `created` / `ready` 阶段。按来源串行的 Host 协调器先持久分配，再创建该精确身份的 Session，刷新 Session 状态后才提交就绪。恢复可以接管阶段写入前已创建且匹配的 Session，但不能替换丢失的已提交目标。此协调方式支持单个写入 Host。

作用域初始化插件向 Host 登记所在 preset 代际。每个关联 Agent 都获得自己的准入监听器、继承工具限制和不可被后续允许覆盖的执行保护。全局创建监听器也会拒绝 preset 已失去初始化插件的关联冷目标。快照元数据来自已有已提交 `user/message` 引用 source 的投影，因此恢复使用投影读取，不私自扫描持久文件。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Remote API、分配、准入与自有资源释放 |
| [`src/question.ts`](src/question.ts) | 作用域初始化入口 |
| [`src/storage.ts`](src/storage.ts) | 经校验的关联记录 |
| [`src/projection.ts`](src/projection.ts) | 来源截取位置与遗漏元数据 |
| [`src/client/index.ts`](src/client/index.ts) | 可选生成 Remote contribution |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会话引用](../../context/session-reference/README.zh.md)——文本保留与遗漏详情。
- [Agent preset](../../preset/agent-preset-registry/README.zh.md)——声明式装配与冷恢复。
- [存储 domain](../../storage/storage-domain/README.zh.md)——业务记录校验与持久性。
- [侧聊 Client](../../client/ui-side-chat/README.zh.md)——面板与输入行为。

-----

<a id="model-experience"></a>
## 模型体验

### 独立问答上下文

#### 模型看到什么

独立 Session 包含用户问题，以及来源中不可信、只读的 `session-reference` 文本快照。来源用户和助手文本及受支持的压缩 checkpoint 遵循引用服务的保留策略。工具原始结果、思考、二进制附件和尚未提交的流式片段不继承。主聊天不会收到侧聊输入或事件。

#### Token 影响

首个侧聊请求承担有预算限制的来源快照与问题 token，后续请求沿用该 Session 历史。引用服务配置控制字节预算和遗漏提示。关联与投影元数据不增加模型 token，也不额外调用模型生成摘要。

#### KV Cache 影响

侧聊拥有自己的请求历史与缓存前缀。首次提交的引用不随来源变化而改变，因此追问不会替换该前缀。主聊天重建出的请求历史保持不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定本功能支持的个人使用范围。

- 每个来源只有一个侧聊，只有一个写入 Host；不支持共享用户授权或多个目标选择。
- 上下文是引用服务有预算限制的文本快照，不等于来源模型当前完整请求。
- 问答 Session 仍作为普通可见 Session 存在；插件不在聊天列表隐藏它们，也不创建嵌套侧聊。
- 继续对话必须保留可选 preset；移除后历史仍可读取，但无法执行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

聚焦 Loader 测试位于 [`tests/side-chat.spec.ts`](tests/side-chat.spec.ts)。受支持 profile 装配、模型输入记录和浏览器验收由可选装配包及其 Client 负责。

</details>
