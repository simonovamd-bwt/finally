#!/usr/bin/env bash
# Stop hook: when Claude finishes and stops, review all changes since the last
# commit and write the result to planning/review.md.
#
# The review is produced by a nested headless `claude -p` call. That nested
# session loads this same project's settings, so WITHOUT a guard its own Stop
# event would re-trigger this hook — an infinite fork bomb. The sentinel env
# var FINALLY_REVIEW_RUNNING breaks that recursion.
set -uo pipefail

# ── Recursion guard ───────────────────────────────────
# The nested `claude` below inherits this var; its Stop hook sees it and exits.
if [[ -n "${FINALLY_REVIEW_RUNNING:-}" ]]; then
  exit 0
fi

# ── Resolve project root (cwd-independent) ────────────
ROOT="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$ROOT" || ! -d "$ROOT/.git" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
cd "$ROOT" || exit 0

OUT="planning/review.md"
mkdir -p planning

# Only meaningful inside a git repo with at least one commit.
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

# ── Collect changes since the last commit ─────────────
# `git add -N` (intent-to-add) makes untracked files show up in `git diff HEAD`
# WITH their contents, so brand-new files are actually reviewed — not just
# listed by name. It stages nothing real (no blob), so it's safe and reversible;
# we undo it immediately after capturing the diff.
UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null)"
if [[ -n "$UNTRACKED" ]]; then
  git add --intent-to-add --  $UNTRACKED >/dev/null 2>&1 || true
fi

DIFF_FULL="$(git diff HEAD 2>/dev/null)"
DIFF_LINES="$(printf '%s\n' "$DIFF_FULL" | wc -l | tr -d ' ')"
DIFF="$(printf '%s\n' "$DIFF_FULL" | head -n 4000)"
if [[ "$DIFF_LINES" -gt 4000 ]]; then
  DIFF="$DIFF
… [diff truncated at 4000 of ${DIFF_LINES} lines] …"
fi

# Undo the intent-to-add so the working tree is exactly as we found it.
if [[ -n "$UNTRACKED" ]]; then
  git reset --quiet -- $UNTRACKED >/dev/null 2>&1 || true
fi

STAMP="$(git log -1 --format='%h %s' 2>/dev/null)"

# Nothing changed → record that and stop (no nested review needed).
if [[ -z "$DIFF" && -z "$UNTRACKED" ]]; then
  {
    printf '# Code Review\n\n'
    printf '_No changes since the last commit (`%s`)._\n' "$STAMP"
  } >"$OUT"
  exit 0
fi

# ── Fallback if the claude CLI is unavailable ─────────
if ! command -v claude >/dev/null 2>&1; then
  {
    printf '# Code Review\n\n'
    printf '_claude CLI not found — diff summary only. Last commit: `%s`._\n\n' "$STAMP"
    printf '## Changed files\n\n```\n'
    git diff HEAD --stat
    if [[ -n "$UNTRACKED" ]]; then
      printf '\nUntracked:\n%s\n' "$UNTRACKED"
    fi
    printf '```\n'
  } >"$OUT"
  exit 0
fi

# ── Nested headless review ────────────────────────────
read -r -d '' PROMPT <<EOF || true
You are a senior code reviewer. Review the following git diff — all changes
since the last commit ($STAMP) — for correctness bugs, security issues, and
simplification opportunities.

Output GitHub-flavored Markdown ONLY (this text is written verbatim to
planning/review.md). Start with '# Code Review', then:
- a one-line **Verdict**,
- '## Blocking issues' (numbered; file references + concrete failure scenario; empty if none),
- '## Non-blocking findings' (numbered; terse),
- '## Untracked files' (list any below, note they aren't reviewed in the diff).

Be specific and evidence-based. Do not restate the diff.

=== git diff HEAD ===
$DIFF

=== untracked files ===
${UNTRACKED:-（none）}
EOF

# FINALLY_REVIEW_RUNNING guards the nested session's own Stop hook against
# recursion. Write to a temp file then atomically mv into place, so a timeout
# (SIGTERM) or a concurrent stop can never leave a half-written review.md.
# A cleanup trap removes the temp file even if the hook is killed mid-run.
# --permission-mode plan + empty --allowedTools keep the nested reviewer from
# acting on any instructions embedded in the diff (treat the diff as data).
TMP="$(mktemp "${OUT}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

if FINALLY_REVIEW_RUNNING=1 claude -p "$PROMPT" \
     --permission-mode plan --allowedTools "" >"$TMP" 2>/dev/null \
   && [[ -s "$TMP" ]]; then
  mv "$TMP" "$OUT" && trap - EXIT
else
  {
    printf '# Code Review\n\n'
    printf '_Review generation failed (nested claude error or timeout). Last commit: `%s`._\n' "$STAMP"
  } >"$OUT"
fi

exit 0
