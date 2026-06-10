// Liveness detection for the ask_user MCP answer-gate.
//
// When Claude calls the ask_user MCP tool, the bridge arms
// `session.waitingForAnswer = 'mcp:<id>'` so the user's next chat message is
// routed back to the MCP server as the answer. A bridge-owned expiry timer
// (set in POST /ask) tears the gate down on timeout — but if the MCP poller
// dies *early* (crash/disconnect) before that timer fires, the gate would stay
// armed and swallow the user's next unrelated message.
//
// The poller hits GET /ask/:id every ~500ms while alive, stamping
// `lastPolledAt`. If that stamp goes stale, no poller is waiting and the gate
// can be expired immediately on the next message instead of lingering until
// the timer fires.

// How long without a poll before we consider the question abandoned. The MCP
// poller polls every 500ms, so 5s (10 intervals) tolerates transient delays
// while still catching an early poller death on the very next message.
export const MCP_GATE_LIVENESS_MS = 5000;

// True when no MCP poller is still waiting for this question's answer. Defaults
// to abandoned when the question is missing or has no poll stamp — the safe
// direction is to let the message reach Claude, never to swallow it.
export function isMcpQuestionAbandoned(question, now, thresholdMs = MCP_GATE_LIVENESS_MS) {
  if (!question) return true;
  const last = question.lastPolledAt;
  if (typeof last !== 'number') return true;
  return (now - last) > thresholdMs;
}
