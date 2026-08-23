export type TraceEventType =
  | "USER_MESSAGE"
  | "FAST_PATH"
  | "RESPONSES_API_REQUEST"
  | "RESPONSES_API_RESPONSE"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "CLARIFICATION"
  | "PENDING_ACTION"
  | "CONFIRMATION"
  | "ACTION_EXECUTED"
  | "ESCALATION"
  | "ASSISTANT_RESPONSE";

export type TraceEvent = {
  id: string;
  type: TraceEventType;
  timestamp: string;
  detail: string;
};

export type ConversationTrace = {
  traceId: string;
  sessionId: string;
  channel: "chat" | "voice";
  events: TraceEvent[];
};

const traces = new Map<string, ConversationTrace>();
let nextTraceId = 1;

export function createTrace(sessionId: string, channel: ConversationTrace["channel"]): ConversationTrace {
  const trace: ConversationTrace = {
    traceId: `TRACE-${nextTraceId++}`,
    sessionId,
    channel,
    events: [],
  };

  traces.set(trace.traceId, trace);

  return trace;
}

export function recordTraceEvent(traceId: string, type: TraceEventType, detail: string): void {
  const trace = traces.get(traceId);

  if (!trace) {
    return;
  }

  trace.events.push({
    id: `${traceId}-EVENT-${trace.events.length + 1}`,
    type,
    detail,
    timestamp: new Date().toISOString(),
  });
}

export function getTrace(traceId: string): ConversationTrace | undefined {
  const trace = traces.get(traceId);

  return trace ? { ...trace, events: [...trace.events] } : undefined;
}

export function resetTracesForTests(): void {
  traces.clear();
  nextTraceId = 1;
}
