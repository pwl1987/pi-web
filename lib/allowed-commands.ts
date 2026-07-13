/**
 * Shared allowlist of agent commands accepted by the HTTP API.
 *
 * Both `POST /api/agent/[id]` and `POST /api/agent/new` validate the inbound
 * command `type` against this set before dispatching to the AgentSession,
 * so a client (or a CSRF) cannot invoke arbitrary wrapper methods.
 *
 * NOTE: `ensure_session` is intentionally absent — it is an internal
 * pseudo-command handled by the `/new` route itself (it does NOT call
 * `session.send`), so it must not pass the shared dispatch gate.
 */
export const ALLOWED_AGENT_COMMANDS: ReadonlySet<string> = new Set([
  "prompt",
  "abort",
  "get_state",
  "fork",
  "navigate_tree",
  "compact",
  "set_model",
  "set_thinking_level",
  "set_session_name",
  "set_session_parent",
  "get_session_stats",
  "get_last_assistant_text",
  "set_auto_compaction",
  "clear_queue",
  "steer",
  "follow_up",
  "get_tools",
  "get_commands",
  "set_tools",
  "reload",
  "abort_compaction",
  "extension_ui_response",
  "extension_ui_input",
  "set_auto_retry",
]);

/** True when `type` is a dispatchable agent command. */
export function isAllowedAgentCommand(type: string): boolean {
  return ALLOWED_AGENT_COMMANDS.has(type);
}
