# Terminology

- **Session:** The whole ongoing conversation. Session usage rolls up all completed model requests.
- **Agent run:** All Agent turns caused by one User message.
- **Turn:** One assistant model request and response, including any tool activity it triggers. A completed turn is the authoritative unit for provider-reported usage.
- **Message:** One item sent by a participant.
- **Role:** Who produced a message: User, Agent, System, or Tool.
- **Content type:** What appears within a message or turn, such as Text, Tool call, Tool result, or Reasoning.
- **Tool call:** An Agent request to run a named tool with specific input.
- **Tool result:** The outcome returned after a tool call, including success, failure, or output.
- **Event:** A live update emitted while a turn runs.

## UI hierarchy

User and Agent are the dialogue participants. Tool calls and tool results appear as typed content within the Agent turn, not as a peer speaker lane. Use this hierarchy when choosing labels in the extension and viewer.

## Token accounting

Per-turn usage comes directly from Pi's provider-reported values. Agent-run and Session figures sum completed turns only. Total input processed is cumulative billed/processed input, not context size. The latest-request context snapshot is separate: it shows that request's input tokens and the model context-window capacity when Pi exposes it. Missing values are not estimated.
