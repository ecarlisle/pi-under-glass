# Terminology

- **Session:** The whole Pi conversation/container, including its messages, Turns, and session-level state changes. Session usage rolls up all completed model invocations.
- **Turn:** One execution of a User goal or prompt. A Turn begins with the User prompt and can contain multiple model invocations, assistant messages, tool calls, and tool results.
- **Model invocation:** One request to a model provider and its response. This is the authoritative unit for provider-reported usage; a Turn may contain more than one.
- **First output latency (TTFO):** Elapsed time from an observed model invocation start to its first Thinking or Text delta.
- **Time to first token (TTFT):** Elapsed time from an observed model invocation start to its first visible Text delta.
- **Message:** One conversation item with a Role and one or more content blocks.
- **Role:** The source or function assigned to a Message. Pi uses `user`, `assistant`, and `toolResult`; the viewer labels `user` as User and `assistant` as Agent.
- **Content type:** The kind of content within a Message or Turn, such as Text, Thinking, System prompt, Tool call, or Tool result as presented by the viewer.
- **System prompt:** Request-level instructions Pi sends to the model during a Turn. It is configuration for the model, not a dialogue participant or ordinary Message.
- **Tool call:** An Agent request to invoke a named tool with specific input.
- **Tool result:** The outcome associated with a Tool call, including output, failure, or status.
- **Thinking:** Intermediate model content exposed by Pi as a `thinking` content block. It is distinct from provider-reported Reasoning tokens.
- **Reasoning tokens:** A provider-reported usage category. It does not necessarily correspond to the visible Thinking content.
- **Event:** A timestamped lifecycle or streaming update about a Session, Turn, model invocation, Message, or tool execution.
- **Context snapshot:** The latest model invocation's input-token usage compared with the model's context-window capacity. It is not cumulative usage.
- **Session marker:** A compact, non-dialogue transcript separator for a meaningful state change, such as selecting a different model or Thinking level, or compacting Context.
- **Context compaction:** Pi's replacement of older Context with a saved summary, followed by the recent Messages kept after the compaction boundary. The viewer records why it happened and the token estimate before compaction; the retained summary is available in a collapsed disclosure.

## UI hierarchy

User and Agent are the dialogue participants. Agent is the viewer label for Pi's `assistant` Role. The System prompt, Tool calls, and Tool results appear as typed evidence within the selected Turn, not as peer speaker lanes. This is a presentation hierarchy; it does not change Pi's underlying Message roles.

## Token accounting

Per-invocation usage comes directly from Pi's provider-reported values. Turn and Session figures sum completed model invocations only. Total input processed is cumulative provider-reported input, not context size. The latest-request Context snapshot is separate: it shows that request's input tokens and the model context-window capacity when Pi exposes it. Missing values are not estimated.

Per-invocation wall time, TTFO, and TTFT are measured from Pi lifecycle events. TTFO and TTFT remain unavailable when the corresponding streaming delta was not observed.
