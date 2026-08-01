# 设计文档：计划模式内联化

## 现状问题

上一轮重构已把输入移入 `ChatInput`，但 `AppShell` 仍在进入计划模式时通过 effect 把
`activeTopPanel` 设为 `"plan"`，弹出一个全高覆盖层（zIndex 500），盖住主聊天区与
`ChatInput`，导致计划模式下输入框被遮挡、无法输入——即用户所说的「独立弹出页面」。

## 方案

1. **AppShell**：删除「进入计划模式自动打开 Plan 覆盖层」的 effect 与
   `activeTopPanel === "plan"` 渲染块；移除 `PlanPanel` 导入、`planMode` 解构，并从
   `activeTopPanel` 状态类型与 `toggleTopPanel` 参数类型中移除 `"plan"` 字面量。
2. **ChatWindow**：导入 `usePlanMode` 与 `PlanPanel`；当 `planMode` 为真时，在消息区
   （`flex-1`）内联渲染 `<PlanPanel/>`，底部仍复用同一个 `chatInputElement`（已是
   plan 感知的统一输入框），不再弹独立页面。
3. **PlanPanel**：因现仅在计划模式下内联渲染，删除永不可达的 `if (!planMode)` 死分支
   与 `planMode` 解构。
4. **i18n**：移除因死分支失效的 `plan.toolbarHint` 死键。

## 风险

- 内联渲染需保证消息滚动区与底部输入框的 flex 布局不被破坏。
- 退出/确认后计划状态保留在 `plan-mode-store` 中，可再次进入恢复。
