# 界面修改范围

[English](ui-redesign.md) | 中文

桌面与 Web 共用一套界面。仅修改界面的任务只调整展示，保持 Harness 行为不变。这些规则不授权超出用户请求的工作。

## 可以改的目录

以下位置只允许修改展示内容，可同步调整对应语言字典、测试和 README。

| 用途 | 目录 |
|---|---|
| 主题样式 | `packages/client/ui-theme/src/styles/` |
| 公共控件 | `packages/client/ui-primitives/src/` |
| 应用布局 | `packages/client/ui-layout/src/client/` |
| 左侧导航 | `packages/client/ui-sidebar/src/client/` |
| 工作区及会话列表 | `packages/client/ui-workspace/src/client/rows/` |
| 聊天展示 | `packages/client/ui-chat/src/client/chat/` |
| 对话和输入区布局 | `packages/client/ui-conversation/src/client/skeleton/` |
| 工具卡片 | `packages/client/ui-tool/src/client/tool/components/` |
| 右侧栏框架 | `packages/client/ui-sidebar-right/src/client/shell/` |

## 不能改的目录和逻辑

其他代码默认不改。尤其是以下范围，除非用户明确授权，否则不能为界面任务修改。

| 区域 | 禁止修改的路径或逻辑 |
|---|---|
| Harness 和 Host 服务 | 其他所有 `packages/` 分组，包括 `core/`、`api/`、`llm/`、`session/`、`host/`、`boot/` 和 `bundle/` |
| Client 基础设施 | `packages/client/connection/`、`modules/`、`web/`、`store/`、`ui-renderer/` 和 `ui-slots/` |
| 桌面和 Web 启动 | `apps/desktop/`、`apps/desktop-host/` 和 `apps/web/` |
| 界面包内的行为逻辑 | Host 入口、输入状态机、提交和上传逻辑、事件装配、业务模型、RPC 调用及权限检查 |
| 配置和生成文件 | Profile、Cordis 配置、依赖、lockfile、构建配置、公共导出及生成产物 |

## 修改原则

- 允许修改目录不等于允许修改其中所有文件或函数。操作回调、请求参数、可用条件和触发时机保持不变。
- 不新增自动发送、重试或审批，不修改 Session 事件、模型输入和存储格式。
- 复用已有组件、Slots、主题变量和语言字典，不为桌面另建一套界面。
- 视觉需求确实需要修改禁止范围时，先说明需要扩大的范围，再修改；不能自行扩大任务。

实现细节遵循 [Client 规则](../../packages/client/AGENTS.md)和 [Web 样式](../web-styling.zh.md)，验证沿用现有[测试策略](../testing.zh.md)。
