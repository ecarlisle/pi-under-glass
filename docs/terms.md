# Terminology

- **Session:** The conversation state belonging to one Pi session, including its messages and agent activity. Session usage rolls up all completed model invocations.
- **Agent run:** One execution of Pi's agent loop initiated by a User request. An Agent run can contain multiple Turns and tool calls.
- **Turn:** One Pi model invocation within an Agent run: the model request and Agent response, plus any associated tool calls and results. A completed Turn is the authoritative unit for provider-reported usage.
- **Model invocation:** One request to a model provider and its response. In Pi, this is normally the accounting unit for one Turn.
- **Message:** One conversation item with a Role and one or more content blocks.
- **Role:** The source or function assigned to a Message. Pi uses `user`, `assistant`, and `toolResult`; the viewer labels `user` as User and `assistant` as Agent.
- **Content type:** The kind of content within a Message or Agent run, such as Text, Thinking, System prompt, Tool call, or Tool result as presented by the viewer.
- **System prompt:** Request-level instructions Pi sends to the model for an Agent run. It is configuration for the model, not a dialogue participant or ordinary Message.
- **Tool call:** An Agent request to invoke a named tool with specific input.
- **Tool result:** The outcome associated with a Tool call, including output, failure, or status.
- **Thinking:** Intermediate model content exposed by Pi as a `thinking` content block. It is distinct from provider-reported Reasoning tokens.
- **Reasoning tokens:** A provider-reported usage category. It does not necessarily correspond to the visible Thinking content.
- **Event:** A timestamped lifecycle or streaming update about a Session, Agent run, Turn, Message, or tool execution.
- **Context snapshot:** The latest model invocation's input-token usage compared with the model's context-window capacity. It is not cumulative usage.
- **Session marker:** A compact, non-dialogue transcript separator for a meaningful state change, such as selecting a different model or Thinking level, or compacting Context.
- **Context compaction:** Pi's replacement of older Context with a saved summary, followed by the recent Messages kept after the compaction boundary. The viewer records why it happened and the token estimate before compaction; the retained summary is available in a collapsed disclosure.

## UI hierarchy

User and Agent are the dialogue participants. Agent is the viewer label for Pi's `assistant` Role. The System prompt, Tool calls, and Tool results appear as typed content within the Agent run, not as peer speaker lanes. This is a presentation hierarchy; it does not change Pi's underlying Message roles. Use it when choosing labels in the extension and viewer.

## Token accounting

Per-Turn usage comes directly from Pi's provider-reported values. Agent-run and Session figures sum completed Turns only. Total input processed is cumulative provider-reported input, not context size. The latest-request Context snapshot is separate: it shows that request's input tokens and the model context-window capacity when Pi exposes it. Missing values are not estimated.
