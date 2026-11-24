# dsh-lite-git — implementation contract

This document is the part of the design that is *not* visible from the outside:
the wire between the two halves, where state lives, the invariants the code is
built around, and — just as importantly — what has **not** been verified.

It is written for whoever changes this plugin next, including a future me who has
forgotten why the discard order is what it is.

---

## 1. What this is, and the shape of the split

A GitHub Desktop-shaped Git panel that lives in DSH's built-in right sidebar.
Three tab types, all session-scoped because that is what the right column is:

| Tab | Kind | Address | Opened by |
|---|---|---|---|
| The panel | `lite-git` | page (`sidebar://lite-git`) | the guide card in the right column |
| The trash | `lite-git-trash` | page (`sidebar://lite-git-trash`) | a button in the panel |
| A diff | `lite-git-diff` | **resource** (`dsh-resource://dsh-lite-git/diff/current`) | double-clicking a file, or a trash entry |

The split between the halves is total: the browser half never touches the disk,
never shells out, and never sees a path it did not get from the host.

```
right sidebar tab (browser)            host process
──────────────────────────            ─────────────
GitPanel / TrashBody / DiffBody
        │
        │  POST /api/dsh-lite-git/rpc
        │  { action, ...payload }            connection.fetch.register
        ▼                                    → admit() (fence + cookie)
   createRoute.fetch ─────────────────────►  → createHandlers[action]
                                                   │
                                                   ├─ git.js    ctx.subprocess
                                                   ├─ repo.js   the operations
                                                   └─ store.js  <DSH_HOME>/dsh-lite-git
```

**Why one route and not one action per route.** `connection.fetch` matches on the
exact pathname and method, and every call already carries a `sessionId` plus the
few fields the action needs. One `POST` with an `action` field keeps the wire
contract in one place — mirrored verbatim in the browser half — instead of
spreading fifteen path literals across two languages.

**Why it must be `connection.fetch` and never `webServer.register`.** The web
server resolves `kind: 'exact'` routes *before* its `/api` prefix route, and
everything that makes an `/api` request safe hangs off that prefix route:
`connection.admit(req)` runs the Host/Origin fence and the browser-cookie check
before `bridge()` dispatches. An exact route on the same path shadows all of it,
turning this into an unauthenticated git surface reachable by anything that can
guess the path. `test/index.test.mjs` and `test/check.mjs` both assert the
carrier, and the check script proves its own assertion is sensitive by running
the predicate against a deliberately broken copy of the source.

---

## 2. The wire contract

`POST /api/dsh-lite-git/rpc`, body `{ action, ...payload }`, `requestBody:
'buffered'`.

Every response is JSON with `cache-control: no-store`. Success is
`{ ok: true, ...data }`. Failure is `{ ok: false, error: { code, message } }`
**and** a meaningful HTTP status — both, on purpose, because the browser half
reads the body and a non-2xx status must not be the only signal. The `message`
the host sends is already user-facing (Chinese), and the browser half localises
`code` when it recognises it, falling back to that message.

### Actions

| action | payload | returns |
|---|---|---|
| `status` | `sessionId` | the whole panel state (see below), or the picker's candidate list when nothing is bound |
| `bind` | `sessionId`, `repoRoot: string \| null` | `{ repoRoot, bound }` or `{ cleared: true }` |
| `repos` | `sessionId` | `{ candidates, scanned, scanTruncated, repoRoot, source }` |
| `commit` | `sessionId`, `summary`, `description?`, `paths: string[]` | `{ commit, ...status }` |
| `commitAndPush` | same | `{ commit, push: { ok, ... } , ...status }` |
| `push` | `sessionId` | `{ action: 'push', outcome, ...status }` |
| `fetch` | `sessionId` | `{ action: 'fetch', outcome, ...status }` |
| `discard` | `sessionId`, `paths: string[] \| null`, `hardDelete` | `{ discard, ...status }` |
| `fileDiff` | `sessionId`, `path` | `{ diff }` |
| `trashList` | `sessionId`, `all?` | `{ entries, total, showAll, repoRoot }` |
| `trashDiff` | `id` | `{ entry, text }` |
| `trashDelete` | `id` | `{ removed }` |
| `trashClear` | `sessionId`, `all?` | `{ removed }` |
| `runScript` | `sessionId` | `{ ran, exitCode?, stdout?, stderr? }` — nothing is thrown for a non-zero exit |
| `saveScript` | `sessionId`, `script` | `{ summaryScript, script }` — an empty `script` clears it |
| `prefs` | `sessionId`, `trashHardDelete?`, `trashShowAllRepos?` | `{ prefs }` |
| `openers` | — | `{ openers: [{ id, label? }], last }` — no session, no repository: the menu is about the machine |
| `openFile` | `sessionId`, `path`, `opener?` | `{ opened: { id, path } }` — the program runs on the host, and the choice becomes `prefs.openWith` |

`paths: null` on `discard` means *every changed file*; an explicit array means
exactly those paths. An array that matches nothing is an `E_BAD_REQUEST`, and a
clean working tree is refused too, so "discard nothing" never writes an empty
archive.

`paths` on `commit` is the ticked set and is **required**: an empty array is
`E_NOTHING_STAGED`, and a `paths` that is not an array of strings is
`E_BAD_REQUEST`. There is no "commit whatever is staged" fallback — that would be
the old model wearing the new protocol, and it would put changes the user
excluded into the commit.

### The status payload

```
{
  workspacePath, workspaceTitle, source: 'binding' | 'detected' | 'none',
  workspaceIsRepoRoot: boolean,
  repoRoot, repoName, head: { oid, short, subject },
  branch: { oid, head, upstream, ahead, behind, detached, unborn },
  remotes: string[],
  files: [{ path, origPath?, index, worktree, kind, untracked, conflicted,
            staged, partial, added, deleted, binary, synthesized? }],
  counts: { files, staged, partial, conflicted, additions, deletions },
  primary: 'push' | 'publish' | 'fetch',
  prefs: { trashHardDelete, trashShowAllRepos, openWith },
  summaryScript
}
```

`workspaceIsRepoRoot` is `true` when the workspace directory is itself the root of
the bound repository, compared through `workspaceKey` so two spellings of one
directory do not read as different ones. It is always present: `false` when
nothing is bound. The panel greys out its unbind button on `true`, because
clearing the binding there changes nothing — the next read re-detects the same
directory — and a press that reports success while changing nothing is worse than
an inert button. Every action that returns a fresh status carries it too.

**`staged` and `partial` are facts about the index, not about the tick.** They
come straight from `git status` (`index !== '.'`, and `index !== '.' && worktree
!== '.'`), they are reported because a panel that hid what the index holds would
be lying by omission, and `counts.staged` is the number of paths whose change is
wholly in the index. The tick the user sees is the client's own choice (§4) and
is derived from the excluded set instead — so `staged: false` on a row says
nothing about whether that row is ticked, and a row with `partial: true` is drawn
like any other. Nothing in the client reads these two fields to decide a tick.

`summaryScript` is the stored script for this repository, falling back to the
`summaryScript` plugin setting, and `''` when neither exists. There is no built-in
starting script: the panel shows exactly this value, so `''` is an empty editor.

`head` is the commit a discarded diff would be taken *against*, which is why the
trash can say "against `a1b2c3d` *init*" and mean it.

### Failure codes

`E_BAD_REQUEST` · `E_UNKNOWN_ACTION` · `E_NO_WORKSPACE` · `E_NO_REPO` ·
`E_NO_GIT` · `E_EMPTY_SUMMARY` · `E_NOTHING_STAGED` · `E_CONFLICT` ·
`E_GIT_FAILED` · `E_NO_REMOTE` · `E_NO_UPSTREAM` · `E_AUTH` · `E_PUSH_REJECTED` ·
`E_TRASH_NOT_FOUND` · `E_TRASH_NOT_RESTORABLE` · `E_NO_FILE` · `E_NO_OPENER` ·
`E_INTERNAL`.

`E_AUTH` and `E_PUSH_REJECTED` exist so the panel can say the one useful
sentence for each instead of pasting git's stderr. Both are derived by pattern
matching git's output in `classifyGitFailure`, which reads **stdout as well as
stderr** — `git commit` with nothing staged exits 1 with an empty stderr and
"nothing to commit" on stdout, and a stderr-only matcher reports that as an
unexplained internal failure.

---

## 3. Where state lives

`<DSH_HOME>/dsh-lite-git/`, falling back to `~/.dsh`. **Do not read
`$DSH_HOME` alone**: the Host process usually does not have it set (the variable
belongs to the shell DSH spawns), so a state file written under a bare
`process.env.DSH_HOME` lands somewhere else or fails to resolve at all. This is
the same trap `dsh-tailscale-remote` documents.

```
bindings.json   { version, bindings: { <canonical workspace path>: { repoRoot, workspacePath, updatedAt } } }
prefs.json      { version, trashHardDelete, trashShowAllRepos, openWith }
scripts.json    { version, scripts: { <canonical repository path>: script } }
trash/index.json  { version, entries: [ ... ] }
trash/<id>.diff   the archived diff, one file per discard operation
```

Every write goes through a temp file plus a rename, so a crash mid-write cannot
truncate a file, and every read-modify-write is serialized per path — two tabs
issuing overlapping mutations is the normal case here, not an edge case.

**Why not the settings service or a storage domain.** A binding is keyed by an
arbitrary absolute workspace path, and a `storageDomain` record key is restricted
to `^[a-zA-Z0-9_-]+$` because it becomes a path segment; `C:\Users\…\<a folder
with spaces>` cannot be one without hashing it, at which point the "native"
option is doing less than the twelve lines here. A settings `Config` would put a
growing map of machine paths into the user-visible settings form, which is worse.

**The binding key** is canonical, separator-normalized, and case-folded on
Windows (`workspaceKey`), so `C:\Foo\`, `C:\Foo` and `c:\foo` are one record. The
original spelling is stored alongside for display.

**A stale binding is dropped, not reported.** If the bound directory is gone, or
is no longer a repository, `resolveBinding` clears the record and re-detects. A
broken binding the user cannot clear from the UI is worse than re-deciding.

---

## 4. The invariant: a tick is a choice, not the index

This is GitHub Desktop's model, adopted after the earlier one ("a tick *is* the
index") produced a state nobody could explain: a file the panel had staged and
that then changed again reads `MM`, `MM` is indistinguishable from a half-stage
someone performed in a terminal with `git add -p`, and the panel drew both as an
indeterminate box. Files nobody had ticked showed up looking half-ticked, and
after a restart the panel could not tell its own staging from a stranger's.

So:

- **Ticking runs no git command at all.** It is a local decision about the next
  commit, held by the client.
- **Unticking runs no git command either.** Same reason.
- A file is ticked unless the user took the tick off. There is one remembered
  thing, the *excluded* set, and it is per repository.
- **Commit builds a temporary index** and commits from it:
  `git read-tree HEAD` (or `read-tree --empty` when there is no commit yet), then
  `git add -A -- :(literal)<path>` for the ticked paths, then
  `git commit -F -` with `GIT_INDEX_FILE` pointing at that file. The real
  `.git/index` is never read for the commit and never written by it.
- After the commit, `git reset -q HEAD -- <literal ticked paths>` brings those
  index entries forward to the new HEAD. That is what keeps a terminal's
  `git status` honest about the paths that were just committed — and it is
  path-limited, so an unrelated staged change elsewhere is untouched.
- `.gitignore`d files are never listed, so they can never be ticked.

`:(literal)` matters: without it, discarding a file named `docs` would also reach
`docs/anything`, and a file named `a[1].txt` would be treated as a pattern.

The two user-visible consequences, stated plainly: **the plugin no longer writes
your index**, and a file you staged by hand in a terminal is neither disturbed nor
turned into a tick — the panel's ticks are about the next commit, and the commit
carries exactly the paths that are ticked.

**The one thing the temporary index cannot see, and the check that replaces it.**
A temporary index seeded from HEAD has no unmerged entries, so `git add` there
would happily stage a conflicted path's working-tree file — `<<<<<<<` markers and
all — where the real index would have refused with `unmerged entries`. The host
therefore asks git which paths are unmerged (`git diff --name-only
--diff-filter=U -z`) and refuses with `E_CONFLICT`, naming the paths, if any
ticked path is among them. The client excludes conflicts from the tick set as
well, but the refusal does not trust that: it is a rule about what may be
committed, not about what the panel happens to have drawn.

**What a refresh does to the ticks.** Nothing. The list is re-read on open, on
return, and when the refresh button is pressed, and the excluded set is not
consulted for any decision about the repository nor changed by the payload that
arrives:

- a path that has just appeared is ticked, because "not excluded" is the default —
  no rule has to notice it;
- a path the user unticked stays unticked, whatever else changes;
- a path that is `MM` — whoever produced the split — is drawn as a plain tick,
  because there is no third state left to draw;
- the excluded set is pruned to the paths still in the list, so a file that is
  committed or reverted and later reappears is ticked again rather than coming
  back unticked for a reason the user cannot see;
- switching the bound repository clears it, so one repository's untick is not
  inherited by another;
- a commit clears it: what was committed is gone, and everything remaining is
  included next time — which is Desktop's post-commit behaviour.

Nothing about this can spin, because no request is involved: a click is a state
update, and the only git process a commit starts is its own.

**The tick is the only control that changes a file's state.** A single press on the
row — the path, the line counts, the space beside them — is deliberately inert: the
list is read by pointing at it, and a press that happens to land on a path must not
commit that file to the next commit. Double-clicking the row still opens its diff,
which is the one row-level gesture, and it is a different button count so the two
cannot be confused. The Shift range is a range *of ticks* for the same reason: it
starts on a checkbox and ends on one.

**The Shift range is one gesture with one snapshot.** A press on a row with Shift
held ranges from the *anchor* (the row the previous press landed on) to this one
and **inverts** every row in between against how the list looked when the batch
started:

- the anchor itself is excluded from the inversion — it is the reference point,
  and the press that set it already settled its own tick;
- holding Shift keeps the anchor, so pressing further along **moves the far end**
  of one batch rather than starting a new one;
- rows that leave the range (the pointer moved back) are restored to that
  snapshot, not flipped a second time — which is why the plan is computed from
  `base` and never from the current tick state;
- letting Shift go ends the batch (a `keyup` on `window`, plus `blur` for the window
  that loses focus before it can deliver the key-up), and the next press starts a
  new batch whose anchor is the row it lands on;
- a plain press also sets the anchor, because "press the first row, hold Shift,
  press the last" is how the gesture is performed in practice;
- conflicted paths are skipped: a tick there is consent to a resolution nobody made.

---

## 5. Discarding, in order, and why

```
1. read the full status                      ── decide the target set
2. refuse if any target is conflicted        ── E_CONFLICT, one sentence
3. build the archive                         ── BEFORE anything is destroyed
     tracked:   git diff --no-color --find-renames HEAD -- <literal paths>
                (+ git diff --numstat … in the same round, for the per-file table)
     untracked: synthesizeNewFileDiff per path, from the file's own bytes
4. cap it on a line boundary                 ── limitDiff, records droppedLines
5. write the trash entry + blob              ── unless hardDelete
6. restore
     tracked:   git restore --source=HEAD --staged --worktree -- <literal paths>
     untracked: delete the file, then prune directories the discard emptied
```

A restore stages nothing: the replayed paths come back as ordinary changes, and a
tick is the panel's choice, so they are in the list and included like anything
else. Writing the index there would only disturb a terminal's staging.

Steps 3 and 6 are not interchangeable. `git restore` destroys the original, so
the archive has to exist first; that is the whole reason the plugin has a trash.

**Why tracked and untracked are restored by different means.** A mixed
pathspec — one untracked path alongside tracked ones — makes the *entire*
`git restore` fail with `pathspec … did not match any file(s) known to git` and
restores nothing (verified on git 2.54). Splitting them is not tidiness; it is
correctness.

**Why untracked paths are deleted rather than restored.** They are not in HEAD,
so `git restore --source=HEAD` cannot reach them. Their content is captured in
step 3 or lost, which is exactly why the synthesized diff exists.

**One entry per discard operation, not one per file.** Discarding a single file
archives one blob with one file in it; "Discard all" archives **one blob holding
every file's diff**, with `scope: 'all'`. That is what was asked for, and it also
means a whole-tree discard is one write rather than N.

**Conflicts are refused, not resolved.** Discarding a conflicted path would mean
`git restore` against HEAD in the middle of a merge, which can disturb the merge
state. The panel says one sentence instead, and `test/e2e.mjs` S12 proves both
the single-file and the discard-all paths refuse.

**`hardDelete` is a per-operation choice, remembered.** The confirmation box's
"delete for good" starts unticked for a first-time user (the safe answer keeps a
copy) and is persisted after each discard, so it mirrors the user's last
decision rather than latching.

---

## 6. The trash

An entry records, so that a diff can still be read months later:

```
{ id, at, repoRoot, repoName, workspacePath, sessionId,
  scope: 'file' | 'all',
  branch: { head, detached },
  base: { oid, short, subject } | null,     ← the commit the diff is against
  files: [{ path, origPath?, kind, added, deleted, binary, synthesized?, oversized? }],
  bytes, truncated, droppedLines, blob }
```

`base` is HEAD at the moment of the discard. That is the answer to "which version
is this a diff against" — and it is recorded rather than inferred, because HEAD
moves.

The list is filtered to the currently bound repository by default; `total` still
reports the whole index, and a toggle shows everything. Clearing with the filter
on clears only the visible repository's entries.

Reading an entry whose `.diff` was deleted by hand still lists it: the metadata
is worth keeping even when the blob is gone, and the read reports the blob as
missing rather than pretending the entry vanished.

---

## 7. The right-sidebar tab identities

```
id:   dsh-lite-git/git     kind: lite-git         page   keepMounted, one guide card (order 30)
id:   dsh-lite-git/trash   kind: lite-git-trash   page
id:   dsh-lite-git/diff    kind: lite-git-diff    resource, patterns: dsh-resource://dsh-lite-git/diff/**
```

`definition.id` is **also the slot key** the body and title register under. Two
consequences the code leans on: a rename in one place without the other silently
renders nothing, and `test/client.test.mjs` asserts every slot key is one of the
three ids.

**Why the diff tab is a resource with a fixed address.** Re-opening a resource
address reveals the tab that is already open — the host looks the content id up
across the whole layout before planning a new tab — and the `params` payload
re-navigates that tab (each open bumps `navigation.revision`). A page kind would
reuse only within the active dock pane, so a tab the user had floated would get a
second copy. The fixed address *is* the "one diff tab, ever" requirement, and the
diff's own chip is a title seat because it has to read the live
`navigation.params` to name the file currently on screen — a title captured at
open time never changes.

**Why `keepMounted` on the panel and not the trash.** The panel holds the tick
state that mirrors the index and a half-written Summary; peeking at a diff must
not lose either. The trash holds only what it re-reads on every visit, so
retaining it would buy nothing.

**The panel re-reads on `tab.visible`.** Coming back to the panel refreshes
quietly, because the working tree may have changed under it — an agent in the
same session is a normal author of those changes.

**The toolbar icon is the only thing outside the right column.** It is a seat in
`conversation.session.header.utilities` — the shell's right-aligned header
utilities, which render immediately left of the ⋯ menu — registered under
`dsh-lite-git/header` with `order: 10`, so it lands after the shipped entries
(`schedule-catalog` is -5) and before the menu at 0. Reusing a shipped id would
put this seat *inside* that cell rather than beside it, which is why the id is
ours and the slot is a `list`.

It reads its count from the same `status` action the panel does, because the seat
mounts whether or not the panel was ever opened, and a change nobody looks at is a
change nobody commits. The count is the changed-file count; a session with no
repository, no git, or a clean tree shows no number at all rather than a `0`.
Pressing it calls `sidebarRight.openTabIn(sessionId, 'lite-git')`, which is the
same door the guide card uses, so a panel already open is *shown* rather than
duplicated. The focus re-read is debounced by 150 ms — the same rhythm the panel's
own return read uses, for the same reason (a burst of focus events is one read).

---

## 7b. Drawing a diff, rather than printing one

The diff tab used to render `git diff` verbatim: every line, `+` and `-` glued to
the front of the content, `diff --git`/`index`/`---`/`+++`/`@@` printed as if they
were source. That is the format's *encoding*, not the change. So `diffRows`
classifies and folds:

- one `file` row per file. The `diff --git`, `index`, `---`/`+++`, mode line and
  `rename from`/`rename to` lines become its `raw` list, and its `badge`
  (`added`/`deleted`/`renamed`/`binary`/`mode`) is derived from them. The tab
  draws the badge as a card; the raw lines are still one press away
  (`data-lite-git-rawtoggle`), because this tab is the only reading of a
  discarded change once `git restore` has run — a renderer that silently dropped
  them would be hiding information, not formatting it;
- `hunk` rows keep the enclosing section (the text git copies after the second
  `@@`) and drop the coordinate from the body — `@@ -12,7 +12,9 @@ function
  render()` is a marker, not a line of the file. The section survives because it
  is the one part a reader can use;
- `\ No newline at end of file` is attached to the row above it (`noNewline`)
  instead of rendering as a stray italic paragraph between two lines;
- `+`/`-` move into a dedicated one-character column (`lite-git-sign`) beside the
  gutter, so **the code column holds exactly what the line says**. `let x = a + b`
  must not read as `+let x = a + b`, and the background colour is what says
  added/removed.

The header card's `+n −n` are counted from the classified rows, not from the
payload's `added`/`deleted`: a single blob can hold several files, and those two
numbers are for the whole diff.

**A paired line repeats the colour, a shade stronger.** git's unified format does
not say which removed line became which added one — it only groups the runs — so
`pairChangedRows` pairs them by position within a hunk, and `changedSpans` runs a
character-level LCS over each pair so only the characters that actually differ get
the stronger background. Two consequences are deliberate:

- a run that removed two lines and added five pairs the first two and leaves the
  rest unpaired, so their whole row keeps the plain colour — the remaining three
  have no counterpart to compare against;
- a line longer than 2000 code points is not compared at all. It is a minified
  bundle, where a character diff has nothing to say, and the O(n·m) table is not
  worth building for it.

**A rename git cannot see is paired by content.** `git mv` produces a `2 <new>`
record with the original path attached. Renaming in a file manager produces
`.D old` plus `? new`, and drawing that as an edit plus a new file describes work
the user did not do. `pairUntrackedRenames` matches an unstaged deletion against
an untracked file whose content is byte-identical, and collapses them into one
`renamed` entry with `origPath`. The rules are conservative on purpose:

- only a deletion with no replacement on disk is a candidate — a modified file is
  never a rename source;
- the content must be *identical*. A rename that also edited the file is
  genuinely ambiguous (it could be two independent changes), and a wrong answer
  would hide a deletion;
- binaries never pair: equal-length binaries are common and comparing them is
  exactly where a silent wrong answer lives;
- a pure rename reports `+0 −0`, so the row does not claim the whole file's line
  count for a file that was only moved.

The pairing is a **display** answer, and `discard` applies the same pairing before
matching paths — otherwise naming the merged path would match only the untracked
half and leave the old name deleted. It is expanded back to the raw paths git
needs before anything is restored or archived.

**Expanding the context is per gap, and that is a protocol decision.** Two hunks
leave a run of unchanged lines between them, and the `@@` coordinates say exactly
how many: the next old-side start minus the previous old-side end. `diffGaps`
computes that range, and pressing its strip asks the host for that range only
(`fileContext`, 1-based and inclusive in old-file lines).

The alternative — re-running the diff with `-U<n>` — widens *every* gap at once,
which is not the gesture: the user pressed one strip. It would also move every
line number below it, so the rows already on screen would shift for a reason the
user did not ask for. Asking for the range keeps the rest of the diff stable.

Two details follow from the gap being *identical on both sides* — which is why it
is a gap at all:

- the host sends **one** text, and the renderer draws the same number in both
  gutter columns;
- a file with no version in HEAD (a new file) has no unchanged lines to expand
  into, so the answer is empty rather than an error the user cannot act on. The
  range is clamped to the file for the same reason: the diff that produced the
  request is allowed to be one refresh stale.

**A gap has two edges, so it gets two buttons.** The strip is one row with the
chevrons in the gutter's column and the count where the code goes — the row is
the affordance, so the buttons are bare rather than filled boxes, which at this
size would out-weigh every control around them. `▾` pulls down from the hunk
above, `▴` pulls up from the hunk below, and each press asks for the next
**20** lines of that edge (`GAP_STEP`, GitHub's own limit for a context request).

The two edges are counted separately (`{ down, up }` per gap) rather than as one
"open" flag, because they are two different questions and the user may press both:
the gap can then fill in from both ends until they meet. Lines are stored by line
number, so the top range and the bottom range cannot overwrite each other, and a
button greys out once its own edge has reached the other.

**Hiding whitespace is `git diff -w`, not a client-side filter.** The client has
the diff text, not the two versions of the file, so it could only guess which
lines differ by whitespace alone. The host runs the same command with `-w` and
sends whatever comes back, so the totals and the hunk boundaries stay consistent
with what is drawn. The toggle is an icon in the header, per tab rather than in
`Config`: it is a way of reading one diff, not a setting for how diffs are read,
and it is re-applied whenever the diff is re-read.

**One background per row.** The gutter used to carry a tint of its own, so the
numbers sat on a different colour from the code beside them — two shades for one
line, and the seam is exactly where the eye lands. The row's colour covers the
whole width now, and the changed characters are marked with a `color-mix` of the
theme's own marker colour, strong enough to read *on* that background. That last
detail is why the mark is a mix rather than a token: the shell has
`--dsw-alias-file-diff-added-marker` (a colour) but no translucent variant of it,
and the first attempt used a name that does not exist, so the fallback put a 22%
tint on an already-tinted row and the mark was invisible.

`diffGaps` resets at every `file` row. Without that, the first hunk of a second
file reads as "starting after where the previous file ended", and the tab offers
to expand lines that were never skipped — which is what a screenshot caught
before it reached a release.

**Hiding whitespace is `git diff -w`, not a client-side filter.** The client has
the diff text, not the two versions of the file, so it could only guess which
lines differ by whitespace alone. The host runs the same command with `-w` and
sends whatever comes back, so the totals and the hunk boundaries stay consistent
with what is drawn. The toggle lives per tab rather than in `Config`: it is a way
of reading one diff, not a setting for how diffs are read, and it is re-applied
whenever the diff is re-read.

**The file list's directory is an rtl box around ltr text, and both halves are
load-bearing.** `direction: rtl` on the directory box is what puts the ellipsis on
the *left* when it has to truncate (`…/docs/guide.md` beats
`docs/deeply/nes…/guide.md`). Applied to the text itself it also reverses the run,
so `.test/abc` lays out as `test/abc.` — a different directory, and the widest
thing in the row, which then overflows first and pushes the file name out of view.
The fix is two nodes: the rtl box for the ellipsis edge, and an
`unicode-bidi: isolate; direction: ltr` span inside it for the text. Dropping
either one brings back one of the two symptoms.

---

## 7a. Handing a file to the user's own program

The diff tab's header carries two controls: one button that opens the file in the
program used last, and a caret that opens a menu of every program the host offers.

**It has to be the host.** The file is on the host's disk and the program has to
run where the file is. A browser tab cannot start `notepad.exe`, and on a remote
client (Tailscale, a second machine) it should not even try: "open this file"
means on the machine holding the repository. The one-line confirmation after a
press exists for exactly that case — locally the window appearing *is* the answer,
remotely nothing else would be.

**It is not a "run this command" endpoint.** The repository root is resolved by
the host, the path is confined to it by the same `absoluteIn` check every other
file action uses, the program has to be one the host itself listed, and the
arguments come from that listing — a client names an id, never an executable.
Four refusals follow from that and are asserted in `test/e2e.mjs` S24: a path
above the root, an absolute path outside it, an id nobody offered, and a file that
is no longer on disk (404, `E_NO_FILE`).

**The three built-ins are ids, not names.** `default`, then the platform's plain
editor (`notepad` / `editor`) and its "show in folder" (`reveal`). The copy lives
in the client's two dictionaries, so the same id reads in either language; only a
`Config.openWith` entry carries a label, because only the user knows what to call
it. A Linux build offers two, not three, rather than naming an editor that may not
be installed.

**`{path}` and `{dir}` are template arguments, not a shell string.** Each item is
already one argument all the way to the child, so a path with a space stays one
argument. An entry with neither placeholder has the path appended, which is the
obvious reading of `command: notepad.exe` with nothing else written.

**The program's exit is not waited for.** An editor stays open for as long as the
user keeps it, so a request that waited would sit on it until `timeoutMs` killed
the thing it launched. What the host does check, before spawning, is that the
program resolves — a missing `openWith` command answers `E_NO_OPENER` instead of
a child that fails a moment after the panel has already said it worked.

**The choice is remembered, as `prefs.openWith`.** Recorded by the action rather
than by a second call, so the button cannot open with one program while the
preference says another. An id that no longer names anything (a config edited
since) reads as "the default" rather than as an empty menu.

---

## 8. Configuration

Every field is volatile, which is what lets the settings page edit them without a
restart — and is why `cordis.patch.yml` deliberately carries **no** `config`
block: values written into the profile's own patch layer must not be shadowed by
this package on the next upgrade.

| field | default | why |
|---|---|---|
| `gitPath` | `''` | Empty means "whatever is on PATH". Set it when git is somewhere unusual. |
| `stateDir` | `''` | Empty means `<DSH_HOME>/dsh-lite-git`. |
| `timeoutMs` | `30000` | Per-command. A push to a slow remote may need more. |
| `maxDiffBytes` | `524288` | Ceiling on one archived diff. A discarding user is having a bad day already; a 200 MB generated file must not become a 200 MB write that then fails. |
| `maxFileBytes` | `2097152` | Larger untracked files are listed but their content is not read, archived, or diffed. |
| `trashLimit` | `200` | Entries kept; the oldest are dropped and their blobs deleted. |
| `scanDepth` | `3` | Directory depth the picker scans below the workspace root. |
| `openWith` | `[]` | Extra programs for the diff tab's menu, on top of the platform's three. A row is `{ label, command, args }`; each arg is one argument, `{path}`/`{dir}` are substituted, and an entry with neither gets the path appended. A half-written row (no label or no command) is skipped rather than thrown on, so a typo cannot park the plugin. |

---

## 9. Verified, and not

### Verified

| what | how |
|---|---|
| porcelain v2 parsing, including a rename, a staged delete, a conflict, a non-UTF-8-hostile path, and a path containing a space | `test/parse.test.mjs`, 47 cases; the conflict fixture pins the nine-field `u` record |
| diff assembly, truncation on line boundaries, per-file splitting | `test/diff.test.mjs` |
| state files, the binding key, corruption tolerance, write serialization | `test/store.test.mjs` |
| the route carrier, single registration under a hostile service order, error classification | `test/index.test.mjs` |
| every registration identity, the wire literals, the dictionaries, and the hook-free components' rendered trees | `test/client.test.mjs` |
| that every registered seat **renders** — the bodies, hidden states, and no-session states | `test/seats.test.mjs` |
| the whole host stack against **real git**, mutation by mutation | `test/e2e.mjs`, 325 assertions over 24 sections that build their own fixtures (S24 starts a real child for the open-with menu) |
| the manifest, the patch layer, the tarball's contents, the two copies of the wire contract, the dictionaries, the workflow | `test/check.mjs` |
| that the client bundle would not abort the Host boot | `scripts/check-client-bundle.mjs` |

The e2e suite is deliberately hostile about §4, in both directions:

- nothing the panel does may write the index (§4) — S4 reads `git status` before
  and after a status read and asserts it is byte-identical, and that `stage` is
  gone from the wire;
- a commit must contain the ticked paths and **only** those — S5 commits one path
  while a terminal has another staged, then asserts the commit's tree holds just
  the named path and that the terminal's staged change is still staged;
- the temporary index cannot see a conflict, so the host must refuse one itself —
  S12 commits a conflicted path and asserts `E_CONFLICT` naming it, plus that
  nothing landed on the branch.

### Not verified

- **`ctx.subprocess` is doubled in the tests.** The shipped service lives inside
  DSH's own bundle and is not importable from a plugin repository, so
  `test/helpers/subprocess.mjs` reproduces its shapes on top of
  `node:child_process`. Those shapes are not guessed: the live contract was read
  off a running DSH (Cordis Inspect, host provider `Service`, key `subprocess`)
  and the double is pinned to it — including the part that is easy to get wrong,
  that `spawn` **throws synchronously** for an already-aborted signal, or for an
  argv/cwd/env/grace it rejects, instead of returning a handle. `S20` exists
  because a caller that only `await`s the handle never sees that throw, and it
  used to reach the route layer unclassified. What the double still does **not**
  reproduce: Windows Job containment, the environment scrubbing, spill files
  (`readFrom`'s `spillPath`), and the `control` duplex.
- **What the live run established.** The plugin loads into a running DSH and all
  three right-sidebar seats register and are active — `dsh-lite-git/git` and
  `dsh-lite-git/trash` (pages) and `dsh-lite-git/diff` (resource) — read
  off the live client slot tree at `sidebar.right.pane.tab`, next to the shipped
  occupants. That is evidence about *mounting*; the behaviour claims are the e2e
  suite's job, and the seam between them is the doubled `ctx.subprocess` above.
- **No headless-DOM render test.** The panel, the trash and the diff are driven
  by hooks, and the three components with no hooks in them (the row, the
  confirmation, the picker) *are* asserted on their element trees. What is not
  covered is real layout: whether the panel actually fills the column, whether a
  diff row's background is the token it claims. A browser harness with a
  hand-written React shim would be needed, and the two bugs that motivate one in
  other plugins in this family were both DOM-measurement bugs — this plugin
  measures nothing and augments no host DOM, so the harness was judged not worth
  its fixture-fidelity cost. That judgement is worth revisiting if the UI grows
  anything hover-dependent or portalled.
- **What a 401 from `/api` does and does not prove.** `connection.admit()` — the
  Host/Origin fence and the browser-cookie check — runs on the `/api` prefix
  route *before* dispatch, so an unauthenticated request to a path nobody serves
  answers 401 as well. `test/live.mjs` therefore reports 401 as *inconclusive*
  rather than as "mounted"; only a 200 (or, when authenticated, a 404) is
  evidence about whether this plugin is actually registered.
- **`openTabIn` / `openResourceIn` are outside the published type contract.**
  They are prototype methods on the sidebar-right controller and are called by
  shipped plugins (including `dsh-deepseek-webchat`), but three source comments
  label them "not part of `ISidebarRight`". This is the first thing to re-check
  on a DSH upgrade.
- **The tab strip's height is now known, and it is load-bearing.** The docking
  kit's `_tabStrip` is `height:28px; padding:10px 6px 0`, so a tab body starts at
  y=38, and the shell's own sidebar tabs (files, browser, deliverables,
  document preview) each open with `height:38px; border-bottom:.5px solid
  var(--dsw-alias-border-l3)`. That is what puts their rule on the same row as
  the conversation header's, which the shell draws at the bottom of the strip
  (measured live: y=76). This panel's header follows the same numbers — a
  border-box 38px box with no vertical padding — because a content-box one with
  8px/6px padding plus a 1px rule came to 39px and left two rules one pixel
  apart. Both the shape and the arithmetic are asserted in `test/client.test.mjs`
  ("puts the header rule exactly on the conversation header line"); the numbers
  were confirmed by measuring the live app, not by reading the kit.
- **Git's path encoding on this machine.** `core.quotepath=false` plus `-z`
  produced UTF-8 paths in every fixture that was checked (including a non-ASCII
  name), and the parsers split on NUL rather than on quoting. A repository whose
  paths git emits in another encoding is untested.

---

## 10. Known limitations

- One repository per workspace, one workspace per binding. No submodules, no
  worktrees, no multiple remotes beyond "prefer `origin`, else the first".
- Push and Fetch always act on a single remote. There is no branch switching, no
  history list, and no stash — that was the agreed scope.
- `git fetch --prune` is what Fetch does, matching GitHub Desktop. It deletes
  remote-tracking refs whose branch the remote no longer has.
- Commit hooks run. A hook that blocks or hangs is the user's own hook; the child
  is killed at `graceMs` only if the command times out, and `timeoutMs` is the
  knob for that.
- The trash keeps the diffs, not the files. Restoring replays the archived diff
  with `git apply`; nothing is staged afterwards, so a restored change comes back
  in the list like any other change and is ticked by the panel's default (§4). A
  diff cut short at the archive size limit, or one whose diff is only `Binary
  files … differ`, is refused for that reason rather than restored incompletely.
- Binary content is not archived — the diff says `Binary files … differ`, which
  is honest but is not a backup.
- An untracked file over `maxFileBytes` is deleted with only a stub in the
  archive. The confirmation box does not yet warn about that specifically.
- "Open with" starts the program on the **host**, so a remote client sees the
  window on the machine that holds the repository, not on the screen in front of
  them. It is also confined to files inside the bound repository: a diff of a trash
  entry has nothing on disk to hand over, and the control is not offered there.
