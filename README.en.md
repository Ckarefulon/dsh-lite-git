# dsh-lite-git

**A GitHub Desktop-style Git panel for DSH**, living in DSH's **built-in right sidebar** — beside Files, Document and Chat.

Changed files, ticks that say what goes into the next commit, a Summary plus a collapsible Description, Commit and Commit and Push, one context button that is Push or Fetch depending on the branch, a discard that archives into the plugin's own trash, and a diff preview — all in that column.

> 中文：[README.md](./README.md)

> **Renamed to `dsh-lite-git` in 0.7.0** (it used to be `dsh-gitbar-lite`). The package id, the RPC route and the
> state directory all moved with it, so remove the old one first: `dsh plugin --profile <your profile> remove dsh-gitbar-lite`,
> then install as below. The old `<DSH_HOME>/dsh-gitbar-lite/` (repository bindings, scripts, trash) can be moved to
> `<DSH_HOME>/dsh-lite-git/` and keeps working.

## Why a right-sidebar tab

The right column is already a permanent tab strip. Putting the panel there means it shares the session's context: **the repository it shows is the one the active session works in**, so switching sessions switches repositories without picking a directory again.

The column is narrow (300px minimum, and a narrow viewport makes it full-screen), so the panel is built for that width: a single-column file list, paths split into name and directory, and a commit box that is one Summary field plus a small triangle that reveals the Description.

## What it does

| | |
|---|---|
| Change list | Modified, added, deleted, renamed and untracked, each with its `+n −n` line counts |
| Ticking | **A tick is a choice about the next commit, and it never touches your index** — the GitHub Desktop model. Clicking only adds or removes the tick; no `git add` runs, and a terminal's `git status` does not change because of it |
| Indeterminate rows | There is exactly one case: you unticked some of the files yourself. Whatever the index holds — including a half-stage from a terminal's `git add -p` — cannot make a row look half-ticked. A row has two states, ticked and not |
| Select all | A tri-state box left of the list heading: tick everything, untick everything, and it reads as mixed when you have unticked some. **Conflicted files are excluded** |
| Ticked by default | **Everything is ticked when the list opens**, and so is anything that appears later — "not unticked" is the default, so no rule has to chase it. What you unticked stays unticked, and a re-read never puts it back. Switching repository or finishing a commit starts from all-ticked again |
| What a commit contains | **Exactly the ticked paths.** The host builds a temporary index from `HEAD` plus those paths and commits from it, so it **never reads and never rewrites your real index** — whatever a terminal staged is still staged afterwards |
| Conflicts | Committing is refused while anything is unresolved, and the refusal names the file. The temporary index has no conflict entries to protect it, so the host checks for this itself |
| Summary / Description | Summary is one always-visible line; the triangle at its right reveals Description |
| Commit | Commits the ticked files; it never runs `git add` |
| Commit and Push | Commits, then pushes. **A failed push never claims the commit failed**: the commit happened, and the panel says "committed `abc1234`, but the push failed" |
| Context button | **Push** when local commits are unpushed, **Publish** when the branch has no upstream, **Fetch** otherwise |
| Fetch before push | A push runs `git fetch --prune` first, then pushes. **Being behind refuses the push** and says by how many — git never merges on a push, so it would be rejected either way, and knowing before the attempt beats being told after. A failed fetch does not block the push |
| Automatic fetch | GitHub Desktop's rhythm while the panel is visible and the repository has a remote: an hour by default, each tick re-asking whether to run, the next scheduled from the *completion* of the last, with a random skew so panels do not sync up. The pace is `autoFetchMs` (`0` to disable), and "was it fetched recently" is answered by `FETCH_HEAD`'s mtime — so a fetch in a terminal counts too |
| Panel regains focus | **Every time the panel is looked at again** the file list is re-read and the script fills the Summary: **opening the panel**, switching back to this tab, clicking into the panel from the conversation, returning to the DSH window, or coming back to the browser tab. A Summary you typed is never replaced — only an empty one, or one that still holds what the script itself wrote, is filled |
| Discard | One file or all of them; the diff is archived *before* anything is restored, and the confirmation offers "delete for good" |
| Trash | Its own tab. Every discard keeps a diff, recorded **against the commit it was taken from** (`abc1234 initial commit`) |
| Diff preview | Double-click a file, or a trash entry, to open a diff tab in the column — **one tab, ever**, re-navigated in place. It is **drawn**, not pasted: one header card per file (path, a `New file`/`Deleted file`/`Renamed`/`Mode changed`/`Binary` badge, `+n −n`), then the code with **green rows for additions and red for deletions, a two-column line-number gutter (old / new)**, and `+`/`−` in a one-character column of its own instead of glued onto the text. Within a paired remove/add the **characters that actually differ get one more shade** (`a - b` → `a + b` marks only the sign). `diff --git`/`index`/`---`/`+++` fold into the card — the `›` at its end still reveals every raw line, so nothing is lost |
| Rename detection | **Both `git mv` and a plain rename in a file manager.** The first one git states itself; the second it reports as "one deleted and one untracked file", and the panel pairs the halves back into a single rename by content (only when the content matches — an edited rename stays two rows, because that really could be two unrelated changes) |
| Open in another program | A button in the diff tab's top-right corner opens the file in **the program used last**; the caret beside it lists everything available: the system default, Notepad, and "show in folder". The program starts on the **host** — so on a phone over Tailscale the window opens on the computer — and the panel says "opened with Notepad" so that is not a guess. Add your own editor with `openWith` in the config |
| Repository binding | A workspace that is itself a repository binds automatically and is remembered; otherwise pick from the repositories found under the workspace, or type a path |

## Requirements

| | |
|---|---|
| DSH `>= 0.2.0-rc.2` | The right-sidebar tab API is this version's behaviour |
| Node `>= 22` | The host half uses `AbortSignal.any` and `node:test` |
| **A local `git`** | Found on `PATH` by default. When it cannot be found the panel says so plainly instead of failing silently; point `gitPath` at it if it lives somewhere unusual |
| A credential | Push uses **the system git's credential helper**. Push once successfully from a terminal and the plugin can push too |

The plugin stores no credential of its own, and the host half reads no secret out of `$DSH_HOME`.

## Install

```sh
dsh plugin --profile <your profile> add dsh-lite-git
```

Restart DSH. Open the right column in a session; its guide page gains a **"Git changes"** card, and that opens the panel.

<details>
<summary>Installing from a local clone / uninstalling / what to do when DSH will not start</summary>

**From a local directory** (use this while changing the code):

```sh
dsh plugin --profile desktop add link:/absolute/path/dsh-lite-git
```

**Uninstall**:

```sh
dsh plugin --profile <your profile> remove dsh-lite-git
```

**DSH will not start after installing**: run `node scripts/check-client-bundle.mjs .` first. DSH reads
`exports["./client"]` as an **exact file path** — no extension completion, no directory fallback — and a manifest
pointing at a file that does not exist raises `MissingClientBundleError` and **aborts the whole Host boot** rather
than merely hiding the plugin. That script reproduces the same resolution so you do not have to find out by restarting.

</details>

## Using it

```
right column, guide page
┌──────────────────────────────────┐
│  ▸ Git changes                   │  ← the guide card
│    Review changes, tick what…     │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ dsh-lite-git  main   ↑1 ↓0    │  ← repository / branch / ahead·behind
│              [Push] [↻] [🗄] [🔗]  │  ← context button, refresh, trash, unbind
│ Changes  5 files · 2 ticked [Discard all] │
│ ☑ M  a.txt                  +3 −1 ↩│  ← click = tick; double-click = diff; ↩ = discard
│ ☑ M  src/big.ts            +12 −4 ↩│
│ ☑ ?  new note.md             +7   ↩│
│ ☐ D  docs/old.md             −31  ↩│  ← the one you unticked stays out of this commit
│ ☑ R  moved.txt                    ↩│
│ ┌────────────────────────────┐ ˅ │  ← ˅ reveals Description
│ │ Summary (required)          │   │
│ └────────────────────────────┘   │
│ [   Commit   ] [ Commit and Push ]│
└──────────────────────────────────┘
```

- **The toolbar icon** sits in the conversation header's top right — the row with the ⋯ menu and the sidebar toggle — and carries the number of changed files. One press opens the Git panel in that session's right column, so you never have to find the tab first. No repository bound, or a clean tree, means no number.
- **Ticking** only adds or removes the tick, from anywhere on the row (no need to hit the small box). It runs no git command and leaves your index alone; a commit takes exactly the ticked files.
- **Shift-clicking** does what it does in every file list: press the first file, hold Shift, press the last one, and everything **between them is inverted** — on stays on, off goes on. Keep holding and press again and the far end moves (the anchor does not), so pressing further extends the same batch and pressing back retracts it, rows returning to the state they started in. Let Shift go and the next press starts a new batch from where you stopped. The anchor keeps the state its own press gave it, so "first to last" gives you "the middle inverted", not "select all"/"select none". Conflicted files never take part.
- **Double-click a row** opens the diff tab; double-clicking another file **reuses that same tab**.
- **Discard** (the ↩ at the end of a row, or "Discard all") opens a confirmation:

  ```
  Discard the changes to "a.txt"?
   · a.txt
   ☐ Delete for good (keep no copy)
     This diff is stored in the plugin's trash, so you can still see what was discarded.
  [ Cancel ]  [ Discard ]
  ```

  **"Delete for good" is unticked by default**, so the diff is archived; tick it and nothing is kept. The box
  remembers your last answer.
- **The trash** (🗄) lists entries by time: how long ago, one file or all changes, the file count, `+n −n`, and
  `against abc1234 initial commit`. Click one for its diff, 🗑 at the end of a row deletes it, and "Empty the trash"
  clears them (only the bound repository, or everything with "Show every repository" ticked).
- **Unbind** (🔗) clears the current binding. **The button is greyed out when the workspace *is* the
  repository root**: clearing the binding there would only re-detect the same directory on the next read,
  so the press would report success and change nothing. The tooltip says as much. It stays live when the
  workspace is somewhere else — a subdirectory of a repository, or a plain folder bound to one by hand.

### While a push or a fetch is running

Push, fetch and commit are network round trips that can take tens of seconds. While one is in flight the
context button in the header **turns into a spinner in place**, with a sentence beside it ("Pushing…"),
the last-fetch line yields its room, and refresh and trash are disabled. Whatever happens — success or
failure — the header goes back to normal afterwards. Ticking a file does *not* do this, because it sends no
request at all: the tick is the panel's own choice about the next commit.

### What discarding actually does

The order is fixed and cannot be swapped:

1. Build a diff of the current changes. Tracked files come from `git diff HEAD`; **untracked new files are turned
   into a synthesized new-file diff by the plugin**, because `git diff HEAD` cannot see them and discarding an
   untracked file deletes it — without synthesizing, the archive would be a bare "one file was deleted".
2. Store it in the trash, unless "delete for good" was ticked.
3. Tracked paths: `git restore --source=HEAD --staged --worktree`. Untracked paths: delete the file, then prune the
   directories that the discard emptied.

> **A conflicted file is refused**, with one sentence. Running `git restore` to HEAD in the middle of a merge can
> disturb the merge state, and that risk is not worth saving a sentence.

### Filling the Summary from a script

**The script is written in the panel.** Below the Description field there is a "script that fills the Summary" toggle;
open it and you get an editor — write it, save it, run it, all without leaving the sidebar. **The editor starts empty**
and nothing is ever seeded into it (the placeholder shows an example); saving, running and refreshing all say so in a
brief notice, so there is no guessing whether the press landed. It also runs by itself **when the panel is opened, and
every time it is looked at again** (switching back to this tab, clicking into the panel from the conversation, or
returning to the DSH window): leave the sidebar open, go and let the agent work in the conversation, come back, and the
Summary is already there. A Summary **you** typed is not overwritten — use the sparkle button when you want it refreshed
anyway. Once a script exists, a sparkle button appears next to the Summary field as a one-click path.

It runs with the **repository root as its working directory** and is fed nothing on stdin, so "read the top version out
of the CHANGELOG" is:

```sh
grep -m1 '^## ' CHANGELOG.md | sed 's/^## //'
```

Whatever it prints becomes the Summary. To fill the Description as well, put a line reading `---` in the output:
everything after it is the Description.

```sh
echo "1.4.2"
echo "---"
echo "Bumped the patch version."
```

About the shell: on Windows the script prefers Git's own `sh` (so `grep`/`sed`/`awk` work) and puts its `usr/bin` back on
`PATH` — without that those tools report "command not found". Only a machine with no `sh` at all falls back to
`cmd.exe`, where the script must be written in cmd syntax. Elsewhere it is plain `sh`.

A failing script does not raise an error banner; its exit code shows as a brief notice, and its stderr is kept verbatim so
you can judge for yourself.


> The script is stored **per repository** (keyed by its path, in `<DSH_HOME>/dsh-lite-git/scripts.json`), so one
> project never runs another one's script. A repository that has never had one opens an **empty** editor — no built-in
> script is filled in, the placeholder is only an example — and an emptied script stays empty.

## Configuration

| field | default | |
|---|---|---|
| `gitPath` | `""` | Explicit git executable; empty means "look on `PATH`" |
| `stateDir` | `""` | Plugin state directory; empty means `<DSH_HOME>/dsh-lite-git` |
| `timeoutMs` | `30000` | Per-command timeout. Raise it for a slow remote |
| `maxDiffBytes` | `524288` | Ceiling on one archived diff; it is cut on a **line** boundary and the dropped lines are recorded |
| `maxFileBytes` | `2097152` | Larger untracked files are listed but not read, archived, or diffed |
| `trashLimit` | `200` | Trash entries kept; the oldest are dropped along with their diff files |
| `scanDepth` | `3` | Directory depth the picker scans below the workspace root |
| `autoFetchMs` | `300000` | How often the panel fetches on its own; `0` disables it, leaving the manual button |
| `summaryScript` | `""` | A script that fills the Summary. It runs with the repository root as its working directory and whatever it prints becomes the Summary; a line reading `---` starts the Description |
| `openWith` | `[]` | Extra programs for the diff tab's "open with" menu, on top of the platform's own three. Each row is `{ label, command, args }`; in `args`, `{path}` becomes the file and `{dir}` its directory, and an entry with neither has the path appended (e.g. `- label: VS Code` / `command: code` / `args: ['{path}']`). Every item is already **one argument**, not a shell command line, so a path with spaces is never split |

Every field is volatile, so a change on the settings page takes effect without a restart.

**Where state lives**: `<DSH_HOME>/dsh-lite-git/` (falling back to `~/.dsh`) — `bindings.json` (workspace →
repository), `prefs.json` (the two remembered choices), and `trash/index.json` plus `trash/<id>.diff`. The trash keeps
**that one diff and nothing else** — no second copy of the file: restoring replays it with `git apply`, so the record the
panel shows and the thing a restore needs are the same bytes. Every write goes through a temp file and a rename, so a
crash mid-write cannot truncate a file.

## How it works

```
lib/shared.js          wire contract literals (the browser half repeats them; the self-check compares)
lib/index.js           entry: Config, apply, one route on connection.fetch
lib/host/git.js        git execution via ctx.subprocess; resolves the executable, bounds output, scrubs env
lib/host/parse.js      porcelain v2 / numstat parsing (pure)
lib/host/diff.js       diff synthesis, line-boundary truncation, per-file splitting (pure)
lib/host/repo.js       status / stage / commit / push / fetch / fileDiff / discard
lib/host/store.js      bindings, preferences, trash (atomic writes, serialized per path)
lib/host/workspace.js  session -> workspace directory
lib/host/routes.js     the single /api route, action dispatch, error-code mapping
lib/client.js          browser half: three tab types, hand-written, no build step
```

The decisions worth writing down:

- **One `/api` route with an `action` field**, not one route per operation. `connection.fetch` matches on the exact
  pathname and every call already carries a `sessionId`; separate routes would spread fifteen path literals across
  two languages.
- **It must register on `connection.fetch`, never as a `webServer` exact route.** The web server resolves exact
  routes *before* its `/api` prefix route, and the Host/Origin fence, the browser-cookie check and the operator peer
  all hang off that prefix route — so an exact route on the same path is an unauthenticated git surface. Both the
  tests and the self-check assert the carrier, and the self-check **proves its own assertion is sensitive** by running
  the predicate against a deliberately broken copy of the source.
- **The diff tab is a `dsh-resource://` address, not a page kind.** Re-opening a resource address makes the host
  reveal the tab that is already open and re-navigate it with the new `params`; a page kind reuses only within the
  active dock pane, so a floated tab would get a second copy. The fixed address *is* "one diff tab, ever".
- **Commit messages go in over stdin (`-F -`), not `-m`**: a Summary containing a quote, a newline, or a leading
  dash is then just text, not an argument.
- **`:(literal)` pathspecs**: without them, discarding a file named `docs` would also reach everything under `docs/`,
  and `a[1].txt` would be treated as a pattern.
- **No `@deepseek-ai/dsh-client-ui-primitives` import.** The browser half requires only `react` — a throwing import
  blanks the whole slot entry, and the official authoring checklist asks a client bundle to import no Harness Client
  package. The few controls it would have supplied are drawn here against the same design tokens, and the icons are
  the host's own artwork (`IconBranchOutlineRegular` and friends) copied path for path, so the column does not look
  foreign.

The full wire contract, the state-file formats, why the discard order is what it is, and what has *not* been verified
are in [`docs/CONTRACT.md`](./docs/CONTRACT.md).

## Verification

```sh
npm test          # unit + real-git e2e + artifact self-check
npm run test:e2e  # the real-git suite alone (23 sections building their own fixtures, 294 assertions)
npm run check     # artifact self-check alone (catches boot-breaking mistakes without restarting DSH)
npm run test:live # probe a running DSH (not part of npm test; needs the app running)
```

| suite | covers |
|---|---|
| `test/parse.test.mjs` | porcelain v2 and numstat parsing, including a rename, a staged delete, a conflict, a non-ASCII path and a path with a space |
| `test/diff.test.mjs` | diff synthesis (missing trailing newline, binary, CRLF), truncation that never splits a character, per-file splitting |
| `test/store.test.mjs` | binding-key normalization, bindings/preferences/trash round-trips, corruption tolerance, no lost update under concurrent writers |
| `test/index.test.mjs` | Config fields and defaults, **the route carrier and single registration**, error-code mapping |
| `test/client.test.mjs` | the real bundle loaded from the manifest's exact path; the three tab types' ids/kinds/guide/keepMounted; every slot key being a registered id; both dictionaries and every failure code; the three hook-free components asserted on their element trees |
| `test/seats.test.mjs` | **every registered seat rendered**, including hidden and no-session states. This one closes a blind spot: `client.test.mjs` never renders the three bodies, and a render-time error in a body blanks the whole panel — which really happened (a `const` named by a dependency array before it was declared threw a ReferenceError and white-screened the panel while the rest of the suite stayed green) |
| `test/focus.test.mjs` | **the only suite that runs effects**: the real bundle against a small React (state, effects with dependency comparison, callbacks, refs), asserting that "looked at again" really happens — one read on open, another on a return, a burst of returns read once, switching the tab away and back counting too — and **where the tick state comes from**: everything ticked on open, an untick surviving a refresh, a newcomer arriving ticked, a path that left the list dropping its memory, and a commit carrying exactly the ticked paths. No other suite runs effects, so they cannot see this class of bug |
| `test/e2e.mjs` | real git through the real handler and route layers: reading a status **leaves the index byte-identical**, a commit contains only the ticked paths (and leaves a terminal's own staging alone), a conflict is refused by the host and named, push to a local bare remote, a rejected push, discarding one file / everything / a rename / an added-then-deleted file, trash add-delete-clear, per-repository filtering, scan depth |
| `test/check.mjs` | the manifest's targets all exist and reach the tarball, the patch layer is one row with no secret, the two copies of the wire contract agree, the dictionaries agree with `locale/*.json`, every `t('literal')` resolves, the README and workflow are present and say the right things |
| `scripts/check-client-bundle.mjs` | reproduces client-modules' resolution: does the file `exports["./client"]` names actually exist |

**There is no real-browser harness**, deliberately: this plugin measures no DOM, augments no host DOM, and portals
nothing to `document.body`, and the fixture's fidelity is itself a cost — plugins in this family have had a bug
frozen green because the fixture copied a CSS rule wrong. The three components with no hooks in them *are* asserted
on their rendered trees, which covers the rules that matter (a tick follows the panel's choice rather than the index,
the confirmation defaults to
keeping a copy, the picker lists its candidates). If the UI ever grows something hover-dependent or measured, that
judgement should be revisited; it is recorded in `docs/CONTRACT.md`.

## Known limitations

- One repository per workspace, one remote per push (`origin` when present). No submodules, worktrees, branch
  switching, history list, or stash.
- Fetch runs `git fetch --prune`, which deletes remote-tracking refs for branches the remote no longer has (matching
  GitHub Desktop).
- Your commit hooks run. A hook that blocks is your hook; `timeoutMs` is the only backstop.
- The trash keeps **that one diff**. Restoring replays it with `git apply`, which reproduces the exact bytes (verified
  with CRLF, no trailing newline, unicode, and trailing spaces). It replays only while the working tree is still what
  the discard left: if HEAD moved, or the files were touched since, the button greys out and says which — otherwise a
  stale change would land on top of newer work. **A restored change is back in the list, ticked by the default rule**:
  the replay only writes bytes into the working tree and never touches the index, so a restored file is an ordinary
  change and is ticked for the same reason every other change is. **A successful restore removes the
  entry**: it is the reverse of the discard that made it, so once the change is back the archive has no use, and
  replaying it again would apply the same change twice.
- Binary content is not archived; the diff says `Binary files … differ`. That is honest, and it is not a backup.
- An untracked file larger than `maxFileBytes` is deleted with only a note in the archive, and the confirmation box
  does not yet warn about that specifically.
- Discarding an untracked file deletes it outright (not into the OS recycle bin). That is the agreed design: the
  plugin's own trash receives it, and with "delete for good" unticked its content is still readable there.
- "Open with" starts the program on the **host**, so a remote client (a phone, a second machine) sees the window on
  the machine that holds the repository rather than on the screen in front of them. It also only reaches files
  **inside the repository**: a trash entry's diff and an already-deleted file have nothing on disk to hand over.

## Publishing (maintainers)

The version number is the release button:

1. Change `version` in `package.json`.
2. Push to `main`.

`.github/workflows/publish.yml` runs `npm test`, then asks `npm view <name>@<version>` — **if that version is already
on the registry it skips quietly** (a green no-op that tells you to bump). Forgetting to bump therefore neither
republishes silently nor shows up as a red run.

Authentication is npm **Trusted Publishing (OIDC)**: there is no token secret anywhere, and `id-token: write` is the
whole credential.

<details>
<summary>One-time setup: bind a Trusted Publisher on npmjs.com</summary>

On the package page → Settings → Trusted Publisher:

| field | value |
|---|---|
| Publisher | GitHub Actions |
| Repository | `Ckarefulon/dsh-lite-git` |
| Workflow filename | `publish.yml` |
| Environment | (leave empty) |

**The first release must be a manual `npm publish`** — a Trusted Publisher can only be bound to a package name that
already exists on the registry.

The workflow deliberately does **not** use `actions/setup-node`'s `registry-url`: it writes
`_authToken=${NODE_AUTH_TOKEN}` into `~/.npmrc`, and that literal placeholder is then sent as a credential. The
registry comes from `publishConfig` instead.

It also upgrades npm to `^11.5.1` first: Trusted Publishing is a feature of the npm CLI, the npm 10 that ships with
Node 22 cannot speak OIDC, and on npm 10 the publish dies with `ENEEDAUTH` — which reads like a missing token but is
really an npm that is too old.

</details>

## License

MIT, see [LICENSE](./LICENSE).

"GitHub Desktop" is a product name of GitHub, Inc. This plugin is not a GitHub product and is not affiliated with
GitHub; it borrows the layout and nothing else.
