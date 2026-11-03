# Bug report — `write_file` fails opaquely on a mistyped argument and cannot create parent directories

**Reporter:** b4nks
**Agent version:** `legacy/master-2025-11-29-742-ga4b9b60-dirty`, sha1 `a4b9b606e51a1c49fbc5d17c6e56b99a335bfe3b`, built with go1.27.3
**Model in affected sessions:** `deepseek/deepseek-v4.1-flash-1017`
**Severity:** Low (no data loss), medium for DX / token waste
**Components:** `write_file` tool handler, error reporting

---

## Summary

Two independent defects in `write_file`, both producing the same unhelpful error class and both
silently recoverable only because the agent found a workaround:

| # | Defect | Consequence |
|---|---|---|
| **A** | A call whose target argument is named `path` instead of `filepath` is accepted, decodes the path as the **empty string**, and attempts to open the **current working directory** | Error reads `open <cwd>: is a directory` — misleading, no mention of the missing argument |
| **B** | `write_file` does not create missing parent directories | Error reads `open <cwd>/<path>: no such file or directory` even though the path was correct |

Neither reports the actual problem, and in case A the path the model intended is discarded without
any indication that it was discarded.

---

## Evidence

### Defect A — wrong argument key silently becomes the cwd

Five occurrences in the primary session (plus one in the secondary session) sent
`{"content": ..., "path": "<target>"}`. The tool requires `filepath`.

```
keys=['content', 'path']  target='src/domain/period.ts'
  → [ERR] ... open /home/b4nks/workspace/sport-app: is a directory

keys=['content', 'path']  target='src/ui/screens/Progress.tsx'
  → [ERR] ... open /home/b4nks/workspace/sport-app: is a directory
```

Note that `src/domain/period.ts` appears **nowhere** in the error message. The intended path is
dropped, and the handler opens the working directory instead.

Corroborating detail: in the surviving logs of the same session, **53 further calls used the
correct `filepath` key successfully**, interleaved with the bad ones — so this is not a consistently
corrupted schema, it is intermittent mistyping by the model that the tool accepts without complaint.

**Argument-key distribution across the 59 `write_file` calls retained in the logs:**

| Keys sent | Count | Result |
|---|---|---|
| `content`, `filepath` | 54 | 53 ok, 1 failed for unrelated reason B |
| `content`, `path` | 5 | **all 5 failed** |

### Defect A reproduces in a second, unrelated session

| Session | Project | Bad-key failures |
|---|---|---|
| `11defee4-6ac9-487b-bf2c-c464541ed7a7` | `sport-app` | 5 |
| `d1c63ebb-e2fb-4105-9990-e02ae708bee7` | `ai-agent` | 1 |
| 7 other sessions on this machine | — | 0 |

Second session's instance:

```
keys=['content', 'path']  target='/home/b4nks/workspace/ai-agent/docs/skill-packs-impl-plan.md'
  → [ERR] ... open /home/b4nks/workspace/ai-agent: is a directory
```

Two unrelated projects, same root cause. Not project-specific.

### Defect B — parent directory not created, immediate retry works

The failure sent the **correct** `filepath` and still failed; an `mkdir -p` two seconds later made
the retry succeed:

```
21:02:34  write_file filepath='src/ui/components/ProgressRing.tsx'
          → open /home/b4nks/workspace/sport-app/src/ui/components/ProgressRing.tsx:
            no such file or directory
21:02:36  bash: mkdir -p src/ui/components && echo ok
          → subsequent write_file succeeded
```

Same shape in the second session (`internal/packs/packs.go`). In both, a **sub**directory was
missing, not the repository root. The defect is simply *"does not mkdir -p the parent"*.

> **Correction to an earlier assumption made while debugging this:** I initially suspected the
> tool was resolving paths against a filesystem snapshot captured at session start. The timestamps
> disprove that — the retry two seconds after `mkdir` succeeded, so resolution is live. The missing
> `mkdir` is the only defect here.

---

## Impact

**No data loss and no incorrect writes.** In every case the file was ultimately created at the
correct path by a retry, either with the right key or via a `bash` heredoc fallback.

**Real costs:**

1. **Token waste.** Each failure is a full request/response round trip, plus a follow-up turn to
   diagnose and retry. In the primary session the 6 failures cost roughly a dozen turns, inside a
   session that logged 56.2 M input tokens.
2. **Silent semantic loss (case A).** The intended target path is discarded and never echoed back.
   An agent that did not verify afterwards would believe the write succeeded at the intended path
   while an empty-path write either failed or (worse, if the handler were ever changed to allow
   writing to a directory) would target the wrong location.
3. **Misleading diagnostics.** `is a directory` points the reader at the filesystem, when the actual
   fault is a missing/renamed tool argument. This directly caused a wrong hypothesis during
   debugging (the "stale FS" theory above), which cost further turns.

---

## Suggested fixes

### A1 (essential, cheap) — validate required arguments before dispatch

Reject an empty or missing `filepath` with an explicit message:

```
write_file: missing required argument 'filepath' (received: content)
```

This single check converts all six defect-A errors across both sessions (5 primary + 1 secondary)
into one self-explanatory message, instead of a filesystem complaint about a directory nobody
mentioned.

### A2 (recommended) — accept common aliases

Coerce `path` / `filename` / `file` → `filepath` when `filepath` is absent, and log a deprecation
warning. Removes the failure mode entirely at negligible cost.

### A3 (recommended) — echo the resolved absolute path in every success response

```
wrote 7585 bytes to /home/b4nks/workspace/sport-app/src/domain/period.ts
```

Makes a dropped path immediately visible and lets the agent verify without a separate `ls`.

### B1 (essential) — create parent directories

`mkdir -p $(dirname "<filepath>")` before opening the file. This matches the behaviour users
already expect from every editor and from `install -D`. Alternatively, fail with an explicit
instruction:

```
write_file: parent directory does not exist: src/ui/components
  (create it first, or use a tool that creates directories)
```

### B2 (optional) — do not treat a directory target as a write destination

If the resolved path exists and is a directory, report that distinctly:

```
write_file: target is a directory, not a file: /home/.../sport-app
```

This alone would have made defect A obvious from the first occurrence.

---

## Reproduction

**A — wrong key:**

```jsonc
{"name": "write_file",
 "arguments": {"content": "hello\n", "path": "src/example.ts"}}
```
Expected: an error naming the missing `filepath` argument.
Actual: `open <cwd>: is a directory`.

**B — missing parent:**

```jsonc
{"name": "write_file",
 "arguments": {"content": "hello\n", "filepath": "does/not/exist/file.ts"}}
```
Expected: the file is created, or a clear "parent directory missing" error.
Actual: `open <cwd>/does/not/exist/file.ts: no such file or directory`; succeeds only after a
manual `mkdir -p`.

---

## Attachments

Primary session: `~/.ai-agent/sessions/11defee4-6ac9-487b-bf2c-c464541ed7a7/events.jsonl*`

| Timestamp | Log file | Keys sent | Target | Error |
|---|---|---|---|---|
| 2026-11-01T21:02:34 | `.1` | `filepath` | `src/ui/components/ProgressRing.tsx` | no such file or directory (defect B) |
| 2026-11-01T21:09:49 | `.2` | `path` | `src/ui/screens/Progress.test.tsx` | is a directory (defect A) |
| 2026-11-01T21:10:08 | `.2` | `path` | `src/ui/components/DayGrid.tsx` | is a directory (defect A) |
| 2026-11-01T21:10:08 | `.2` | `path` | `src/ui/components/PeriodSwitcher.tsx` | is a directory (defect A) |
| 2026-11-01T21:10:33 | `.2` | `path` | `src/ui/screens/Progress.tsx` | is a directory (defect A) |
| 2026-11-03T21:54:03 | `.3` | `path` | `src/ui/components/QuickAdd.test.ts` | is a directory (defect A) |

Secondary session: `~/.ai-agent/sessions/d1c63ebb-e2fb-4105-9990-e02ae708bee7/events.jsonl*`
(`2026-10-25T11:37:37` — defect A on an absolute path; `11:42:32` — defect B on
`internal/packs/packs.go`).

Each failure can be cross-referenced by decoding `tool_calls[].Args` and matching `tool_call_id`
against the following `role: "tool"` message. Note that older log segments rotate, so call counts
here are for the retained files only.

---

## Note on attribution

The mistyped argument (`path`) originates in **model generation**, not in the agent's schema — the
schema is not present in the event log at all, and 54/59 retained calls used the correct key in the
same session. So defect A is arguably *"the model typed the wrong key"*.

The **bug** is that the tool accepted it, discarded the intended path, and reported an error about
the filesystem instead of about the argument. Defect B is purely agent-side.
