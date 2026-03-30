import { asString, asNumber, parseObject, parseJson } from "@paperclipai/adapter-utils/server-utils";

export function parseCodexJsonl(stdout: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  let errorMessage: string | null = null;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    if (type === "thread.started") {
      sessionId = asString(event.thread_id, sessionId ?? "") || sessionId;
      continue;
    }

    if (type === "error") {
      const msg = asString(event.message, "").trim();
      if (msg) errorMessage = msg;
      continue;
    }

    if (type === "item.completed") {
      const item = parseObject(event.item);
      if (asString(item.type, "") === "agent_message") {
        const text = asString(item.text, "");
        if (text) messages.push(text);
      }
      continue;
    }

    if (type === "turn.completed") {
      const usageObj = parseObject(event.usage);
      usage.inputTokens = asNumber(usageObj.input_tokens, usage.inputTokens);
      usage.cachedInputTokens = asNumber(usageObj.cached_input_tokens, usage.cachedInputTokens);
      usage.outputTokens = asNumber(usageObj.output_tokens, usage.outputTokens);
      continue;
    }

    if (type === "event_msg") {
      const payload = parseObject(event.payload);
      if (asString(payload.type, "") === "token_count") {
        const info = parseObject(payload.info);
        // Prioritize last_token_usage (heartbeat delta) over total_token_usage (session cumulative)
        const lastUsage = parseObject(info.last_token_usage);
        if (asNumber(lastUsage.total_tokens, 0) > 0) {
          usage.inputTokens = asNumber(lastUsage.input_tokens, usage.inputTokens);
          usage.cachedInputTokens = asNumber(lastUsage.cached_input_tokens, usage.cachedInputTokens);
          usage.outputTokens = asNumber(lastUsage.output_tokens, usage.outputTokens);
        } else {
          // Fallback to total_token_usage if last is missing
          const totalUsage = parseObject(info.total_token_usage);
          usage.inputTokens = asNumber(totalUsage.input_tokens, usage.inputTokens);
          usage.cachedInputTokens = asNumber(totalUsage.cached_input_tokens, usage.cachedInputTokens);
          usage.outputTokens = asNumber(totalUsage.output_tokens, usage.outputTokens);
        }
      }
      continue;
    }

    if (type === "turn.failed") {
      const err = parseObject(event.error);
      const msg = asString(err.message, "").trim();
      if (msg) errorMessage = msg;
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    usage,
    errorMessage,
  };
}

export function isCodexUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|missing rollout path for thread|state db missing rollout path/i.test(
    haystack,
  );
}
