# Bug reports — `write_file` (2 defects)

Two independent defects in the `write_file` tool, filed as separate reports because they have
different causes, different fixes, and different owners.

| # | Title | Area | Severity |
|---|---|---|---|
| 1 | Missing/renamed target argument silently writes to the cwd | `area/tools` | Medium |
| 2 | Missing parent directories are not created | `area/tools` | Low |

**Environment (both)**

- Agent: `legacy/master-2025-11-29-742-ga4b9b60-dirty`, sha1 `a4b9b606e51a1c49fbc5d17c6e56b99a335bfe3b`, go1.27.3
- Model in affected sessions: `deepseek/deepseek-v4.1-flash-1017`

---

# Report 1 — Missing/renamed target argument silently writes to the cwd

## What's broken

A `write_file` call whose target argument is named `path` instead of `filepath` is accepted. The
target decodes as the **empty string**, so the handler attempts to open the **current working
directory**, and the call fails with:

```
[ERR] Can't execute the function write_file, got failed to write file,
      got: open /home/b4nks/workspace/sport-app: is a directory
```

Two things are wrong beyond the write failing:

1. **The intended path is discarded and never echoed.** The error names the cwd, not
   `src/ui/screens/Progress.tsx`. Nothing in the output indicates which argument was missing.
2. **The message blames the filesystem.** `is a directory` points at the target path; the actual
   fault is a missing/renamed tool argument. This is actively misleading while debugging.

## Expected

Either:

- **reject before dispatch**, naming the missing argument:
  ```
  write_file: missing required argument 'filepath' (received: content)
  ```
- **or accept the alias** and write to the intended file, logging a deprecation warning.

Presenting a directory as a write destination should never be attempted. If the resolved path
exists and is a directory, say so distinctly:

```
write_file: target is a directory, not a file: /home/b4nks/workspace/sport-app
```

Success responses should echo the resolved absolute path, so a dropped target is visible
immediately:

```
wrote 4734 bytes to /home/b4nks/workspace/sport-app/src/ui/screens/Progress.tsx
```

## Repro

Single call with the argument misnamed:

```jsonc
{"name": "write_file",
 "arguments": {"content": "hello\n", "path": "src/example.ts"}}
```

Observed: `open <cwd>: is a directory`.
Expected: an error naming `filepath`, or a successful write to `src/example.ts`.

**Confirmed in two unrelated sessions on the same machine:**

| Session | Project | Occurrences |
|---|---|---|
| `11defee4-6ac9-487b-bf2c-c464541ed7a7` | `sport-app` | 5 |
| `d1c63ebb-e2fb-4105-9990-e02ae708bee7` | `ai-agent` | 1 |
| 7 other sessions | — | 0 |

Secondary session instance (absolute path, same shape):

```
keys=['content', 'path']  target='/home/b4nks/workspace/ai-agent/docs/skill-packs-impl-plan.md'
  → [ERR] ... open /home/b4nks/workspace/ai-agent: is a directory
```

Repro artifact: session logs listed under **Notes**.

## Area

`area/tools`

## Notes

**Timeline, primary session** `~/.ai-agent/sessions/11defee4-6ac9-487b-bf2c-c464541ed7a7/events.jsonl*`

| Timestamp | Log file | Keys sent | Target |
|---|---|---|---|
| 2026-11-01T21:09:49 | `.2` | `path` | `src/ui/screens/Progress.test.tsx` |
| 2026-11-01T21:10:08 | `.2` | `path` | `src/ui/components/DayGrid.tsx` |
| 2026-11-01T21:10:08 | `.2` | `path` | `src/ui/components/PeriodSwitcher.tsx` |
| 2026-11-01T21:10:33 | `.2` | `path` | `src/ui/screens/Progress.tsx` |
| 2026-11-03T21:54:03 | `.3` | `path` | `src/ui/components/QuickAdd.test.ts` |

**Suspected cause.** The handler reads `filepath` and does not validate it. A missing key yields
`""`, which resolves to the cwd. There is no argument-presence check between decoding and `open()`.

**Attribution.** The mistyped key originates in **model generation**, not in the agent's schema —
the schema does not appear in the event log at all. In the same session, many other `write_file`
calls used the correct `filepath` key successfully, interleaved with the failing ones, so this is
intermittent generation rather than a corrupted schema. The model typed the wrong name; the defect
is that the tool accepted it, discarded the intended target, and reported a filesystem condition
instead of an argument error.

(Exact call counts are deliberately not given: the session's event logs rotate during a live
session, so any ratio quoted here would be unstable. The per-failure timestamps and log files in
the table above are the stable evidence.)

**How to read the logs.** Match `tool_calls[].Args` (decode the JSON; check for `path` vs
`filepath`) to the following `role: "tool"` message via `tool_call_id`. Filter on
`message.name == "write_file"`: the session log also contains the agent's own debugging commands,
which quote the same error strings and will inflate any naive `grep`.

**Impact.** No data loss — the file was ultimately written by a retry with the correct key. Cost:
wasted round trips and a misleading diagnostic that sent debugging toward a wrong hypothesis (see
report 2, Notes).

---

# Report 2 — Missing parent directories are not created

## What's broken

A `write_file` call with a **correct** `filepath` fails when a parent directory does not exist:

```
[ERR] Can't execute the function write_file, got failed to write file,
      got: open /home/b4nks/workspace/sport-app/src/ui/components/ProgressRing.tsx:
           no such file or directory
```

Running `mkdir -p src/ui/components` by hand makes the immediate retry succeed, so nothing else is
wrong — the directory creation is simply missing.

## Expected

Create the parent directory, matching what every editor and `install -D` do:

```
mkdir -p $(dirname "<filepath>")
```

Alternatively, fail with an action the caller can take:

```
write_file: parent directory does not exist: src/ui/components
  (create it first, or use a tool that creates directories)
```

## Repro

```jsonc
{"name": "write_file",
 "arguments": {"content": "hello\n", "filepath": "does/not/exist/file.ts"}}
```

Observed: `no such file or directory`.
Expected: the file is created, or a clear "parent directory missing" error.

Real occurrence, with the successful retry two seconds later:

```
21:02:34  write_file filepath='src/ui/components/ProgressRing.tsx'
          → open /home/b4nks/workspace/sport-app/src/ui/components/ProgressRing.tsx:
            no such file or directory
21:02:36  bash: mkdir -p src/ui/components && echo ok
          → subsequent write_file succeeded
```

Repro artifact: `events.jsonl.1` in the primary session.

## Area

`area/tools`

## Notes

**Timeline.** `2026-11-01T21:02:34`, log file `events.jsonl.1`. Identical shape in the secondary
session (`d1c63ebb…`, `2026-10-25T11:42:32`, target `internal/packs/packs.go`). In both cases a
**sub**directory was missing, not the repository root.

**Correction to an earlier hypothesis, recorded so it is not repeated.** While debugging this I
suspected the tool resolved paths against a filesystem snapshot captured at session start. The
timestamps disprove it: the retry succeeded two seconds after `mkdir`, so resolution is live. The
missing `mkdir` is the entire defect — there is no stale-cache component.

**Impact.** One wasted round trip per occurrence, plus a diagnostic that looks like a path bug and
invites the wrong investigation.

---

## Suggested fixes, in priority order

| Priority | Fix | Covers |
|---|---|---|
| 1 | Validate required arguments before dispatch; name the missing one | Report 1 |
| 2 | `mkdir -p` the parent before opening | Report 2 |
| 3 | Accept `path` / `filename` / `file` as aliases for `filepath` | Report 1 |
| 4 | Echo the resolved absolute path in success responses | Report 1 |
| 5 | Report "target is a directory, not a file" distinctly | Report 1 |
