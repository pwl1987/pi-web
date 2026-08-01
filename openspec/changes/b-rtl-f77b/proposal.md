# 计划模式交互重构（change b-rtl-f77b）

## 目标

将计划模式从「独立弹出覆盖层 + 独立输入组件」重构为「主聊天区内联、复用统一消息输入框」的交互形态，并清理所有相关死代码。

## 范围

- `components/AppShell.tsx`：移除进入计划模式自动弹出 Plan 覆盖层的 effect 与渲染块。
- `components/ChatWindow.tsx`：planMode 时于消息区内联渲染 PlanPanel，底部复用同一 ChatInput。
- `components/PlanPanel.tsx`：移除非独立输入相关死代码，仅作展示面板。
- `lib/plan-mode-store.ts` / `lib/i18n/*`：精简计划模式状态与文案。

## 验收

- 进入计划模式后无独立弹层，讨论内容内联于主聊天区。
- 底部输入框即统一入口，发送/反馈/禁用态随 planStatus 切换。
- tsc / eslint / prettier / node 测试 / vitest 全绿。
