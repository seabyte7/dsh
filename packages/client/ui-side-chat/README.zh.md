---
description: "在聊天右侧独立提问，并通过右侧栏恢复侧聊历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-side-chat

[English](README.md) | 中文

## 概述

在主任务继续执行时，通过聊天旁边的侧聊提问。打开面板不创建 Session；首次提交问题后才启动关联侧聊。关闭标签会保留历史，也不会停止回答。面板只接受文本问题，并显示来源快照是否已裁剪。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在聊天头部选择“侧聊”，输入问题后选择“发送”。后续问题沿用同一侧聊历史。停止操作只影响侧聊；关闭标签仅释放浏览器视图。已有右侧栏负责面板位置、宽度调整和窄屏展示。

本插件通过 `cordis.yml` 条目装配，没有配置字段。装配需要[侧聊 Host](../../session/side-chat/README.zh.md)、Conversation、Session UI、资源、语言和右侧栏服务。缺少 Remote 注册时，功能不会激活。

查询失败会在保留历史旁显示，并提供“重试加载”。目标已归档或删除时保持不可用，不创建替代历史。首个问题交接失败时保留问题；已有目标草稿会保留，须先发送或清空该草稿才能重试交接。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

标签由仅包含来源身份的 `dsh-resource://sidechat/session/<source>` 地址标识。资源在打开及连接重置后查询关联，持有目标 Session 引用，并在最后一个持有者关闭时释放引用。声明的视图 store 保存未发送的来源问题和稳定创建身份，使其在标签正文重新挂载后仍然可用。

首个问题调用 Host 关联服务，独立持有提交引用，并请求在该确切 Session 绑定上初始化草稿。只有初始化结果为 applied 时才进入普通输入状态机；交接过程绝不提交保留或阻塞的草稿。提交引用持续到已有输入接纳流程及待定回显结束。独立绑定的 SessionProvider 渲染公共 Conversation Factory 的 embedded 变体，并固定使用 Chat 视图。

已提交的侧聊投影在首次快照前即可标识问答 Session，之后报告实际来源位置和裁剪信息。composer chain 条目只接管这些 Session 或资源已发现的目标。它使用既有输入动作和目标作用域的取消操作，不提供附件、模型或 preset 控件。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

以下文档说明本包复用的服务与展示机制。

- [侧聊 Host](../../session/side-chat/README.zh.md)——关联、快照准备与问答策略。
- [Conversation](../ui-conversation/README.zh.md)——已有输入接纳流程与内嵌内容。
- [右侧栏](../ui-sidebar-right/README.zh.md)——标签布局与恢复。
- [Client 资源](../../../docs/subsystems/client-resources.zh.md)——共享资源所有权。

-----

<a id="model-experience"></a>
## 模型体验

无，本包展示浏览器侧聊，不注册面向模型的能力。

#### KV Cache 影响

无；Host 与普通 Session 输入负责提交的问题和来源快照。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

问答输入框仅提供受支持的提问操作。

- 以 `/` 开头的问题会显示字段提示并保留为草稿；不支持斜杠命令。
- 已有或拖入的附件会阻止发送，并保留到用户选择“移除附件”；问题文本保持不变。
- 未发送的来源草稿在当前浏览器进程内跨视图重新挂载保留；本包不承诺浏览器重启后继续保存。
- 面板展示有预算限制的文本快照，不与主任务实时同步，也不继承文件或图片内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
