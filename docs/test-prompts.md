# Viewer test prompts

**Use when:** Generating live session activity to check how the viewer displays it

Send these prompts in order to a model in Pi, with `/underglass` already open, to see every kind of turn the viewer renders. They use only read-only tools, so nothing is produced or changed.

Open the viewer before the first prompt. A tab opened later only receives a compact snapshot, not the full transcript. For deterministic sample data without a live model, see `/underglass debug` in [Development and validation](development.md).

## 1. Plain turn: text, TTFO/TTFT, usage

```text
In three sentences, explain what a local-first browser extension for a coding agent could show a user about their session. Don't use any tools.
```

## 2. Thinking and a longer reasoning trace

```text
Think carefully before answering: a session has 4 turns using 1200, 800, 2500 and 300 input tokens. If the context window is 8000 tokens, what fraction does the last turn use, and what fraction of the window has been processed in total? Show your reasoning, but don't use any tools.
```

## 3. Many successful tool calls in one turn

```text
Without modifying anything, explore this repository: list the top-level files, read package.json, read AGENTS.md, then search for the word "token" under src/ and tell me in two sentences how auth works. Use only read-only tools.
```

## 4. Failing tool calls (error state)

```text
Try to read the file ./does-not-exist.txt, then run the shell command `ls /no/such/directory`, then tell me what each error said. Do not create or change any files.
```

## 5. Session markers

Before sending the prompt, change the model with `/model` and the thinking level in Pi. Optionally run `/compact` for a context compaction marker.

```text
Briefly summarize what we've done in this session so far, as a bulleted list. Don't use any tools.
```
