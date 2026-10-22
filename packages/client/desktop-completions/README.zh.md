---
description: "让 macOS Dock 完成角标与未读 Session 结果、主对话查看状态保持同步。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-desktop-completions

[English](README.md) | 中文

## 概述

在 Desktop 中使用本包，可让 macOS Dock 计数与侧栏完成提醒保持一致。窗口隐藏或失焦时，结果保持未读，即使对应对话仍被选中。在获得焦点的主对话中打开结果，只会确认已加载的结果。其他桌面平台和普通浏览器保留现有提醒行为。

## 目录

- [完成提醒](#completion-reminders)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="completion-reminders"></a>
## 完成提醒

内置 Desktop profile 加载本插件。macOS preload 提供完整未读快照；没有该 API 的浏览器不执行原生操作。[Desktop 应用](../../../apps/desktop/README.zh.md#closing-the-window-and-quitting)拥有原生计数、完成分类、焦点检查与重置行为。

适配器将壳快照注册为 [Session UI](../ui-session/README.zh.md) 的完成状态源。只有对应 Session 是保留的主对话、历史已打开，且没有全局主面板替换对话时，才会上报最新已加载的轮次边界。侧栏保留 Session，或在显示其他面板时保留主 Session，均不确认已读。壳还要求窗口可见、获得焦点且未最小化；旧的已加载位置不能确认更新的完成结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

壳拥有跨渲染器重载的未读集合。Client 在请求基线前先订阅，并拒绝较旧修订的快照。主 Session 的历史通过 Controller 现有事件窗口观察，首次打开后使用增量变化。dispose（资源释放）会移除所有状态源订阅，等待已提交 IPC 完成，再释放主查看位置。原生读取或确认失败时会报告诊断，并保留最新未读快照。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本插件不注册面向模型的工具或提示词内容。

#### KV Cache 影响

无；原生未读状态不会进入模型请求或 Session 事件。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 未读结果仅保留在当前 Desktop 进程内，Host 被替换时重置；应用重启不重放历史完成通知。
- 查看确认表示已完成轮次已加载到当前主对话；不跟踪用户是否滚动到每一条消息。
- 原生完成角标仅支持 macOS。系统横幅和通知点击跳转属于独立能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
