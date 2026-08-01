# 实施计划：计划模式内联化

- [x] AppShell：移除 Plan 覆盖层 effect、渲染块、PlanPanel 导入与 planMode 解构
- [x] AppShell：从 activeTopPanel 类型与 toggleTopPanel 参数类型移除 "plan"
- [x] ChatWindow：导入 usePlanMode + PlanPanel，planMode 内联渲染 PlanPanel 并复用底部输入框
- [x] PlanPanel：删除 if(!planMode) 死分支与 planMode 解构
- [x] i18n：移除失效的 plan.toolbarHint 死键
- [x] 验证：tsc / eslint / prettier / node 测试 / vitest 全绿
- [x] 提交并推送到 phase1-2-engineering-security
