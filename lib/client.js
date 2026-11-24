/**
 * dsh-lite-git — browser half.
 *
 * A hand-written lazy-CJS bundle: `window.__ModuleLoader__.load({ id, factory })`
 * with a `factory` that requires React and nothing else. No build step, no JSX,
 * no TypeScript. `@deepseek-ai/dsh-client-ui-primitives` is deliberately NOT
 * required: a throwing import blanks the whole slot entry, the seed module table
 * is a runtime contract this plugin would rather not widen, and the official
 * authoring checklist asks a client bundle to import no Harness Client package.
 * The handful of controls it would have supplied are drawn here against the same
 * design tokens, and the icons below are the host's own artwork copied
 * path-for-path so the column does not look foreign.
 *
 * Three tab types, all in the built-in right sidebar:
 *
 *   `lite-git`        the panel — changed files, tick-to-stage, Summary +
 *                   Description, Commit / Commit and Push, one context button
 *                   that is Push or Fetch depending on the branch, discard with
 *                   a confirmation box, and a repository picker for a workspace
 *                   that is not a repository.
 *   `lite-git-trash`  the plugin's own trash: the diffs discarded changes left
 *                   behind, with the base commit each one was taken against.
 *   `lite-git-diff`   one diff, in a single reused tab. A `dsh-resource://`
 *                   address (rather than a page kind) is what makes it a
 *                   singleton: the host reveals an already-open resource instead
 *                   of stacking a second copy, and a fresh `params` payload
 *                   re-navigates the tab that is already there.
 *
 * The panel and the trash tab are page kinds, opened by kind; only the panel
 * carries a guide card, because it is the one the user needs to find.
 *
 * @module dsh-lite-git/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-lite-git',
  factory: (require) => {
    // The loader passes `require` but no `module`, so every bundle declares its
    // own CommonJS-ish pair, exactly as the shipped bundles do.
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback
    const useMemo = React.useMemo
    const useRef = React.useRef

    /* ------------------------------------------------------------------ *
     * 1. Wire contract — mirror of lib/shared.js
     * ------------------------------------------------------------------ */

    /** Package name; also the module-loader id and the locale namespace. */
    const PLUGIN_ID = 'dsh-lite-git'

    /** The one exact host route this half talks to. */
    const RPC_ROUTE = '/api/dsh-lite-git/rpc'

    /** Every action name the host dispatches on (mirror of `ACTIONS`). */
    const ACTIONS = {
      STATUS: 'status',
      BIND: 'bind',
      REPOS: 'repos',
      COMMIT: 'commit',
      COMMIT_PUSH: 'commitAndPush',
      PUSH: 'push',
      FETCH: 'fetch',
      DISCARD: 'discard',
      FILE_DIFF: 'fileDiff',
      FILE_CONTEXT: 'fileContext',
      TRASH_LIST: 'trashList',
      TRASH_DIFF: 'trashDiff',
      TRASH_DELETE: 'trashDelete',
      TRASH_CLEAR: 'trashClear',
      TRASH_RESTORE: 'trashRestore',
      RUN_SCRIPT: 'runScript',
      SAVE_SCRIPT: 'saveScript',
      PREFS: 'prefs',
      OPENERS: 'openers',
      OPEN_FILE: 'openFile',
    }

    /** Which label the single context button wears (mirror of `PRIMARY_ACTIONS`). */
    const PRIMARY = { PUSH: 'push', PUBLISH: 'publish', FETCH: 'fetch' }

    /** Diff-scope badge on a trash entry (mirror of `DISCARD_SCOPE`). */
    const SCOPE = { FILE: 'file', ALL: 'all' }

    /* ------------------------------------------------------------------ *
     * 2. Locale namespace, tab identities, and the dictionary
     * ------------------------------------------------------------------ */

    const NS = PLUGIN_ID

    /** The panel's tab type. `id` is also the slot key its body registers under. */
    const GIT_ID = `${PLUGIN_ID}/git`
    const GIT_KIND = 'lite-git'

    /** The trash tab type. */
    const TRASH_ID = `${PLUGIN_ID}/trash`
    const TRASH_KIND = 'lite-git-trash'

    /**
     * The diff tab type.
     *
     * `dsh-resource://` with a fixed address, not a page kind: re-opening the
     * same address reveals the tab that is already open (the host looks the
     * content id up across the whole layout before planning a new tab), and the
     * `params` payload re-navigates it. That is exactly "one diff tab, ever".
     */
    const DIFF_ID = `${PLUGIN_ID}/diff`
    const DIFF_KIND = 'lite-git-diff'
    const DIFF_ADDRESS = 'dsh-resource://dsh-lite-git/diff/current'
    const DIFF_PATTERN = 'dsh-resource://dsh-lite-git/diff/**'

    /** Where the guide card sits: after the shipped files(10) and terminal(20). */
    const GUIDE_ORDER = 30

    /**
     * The seat key of the toolbar icon.
     *
     * The conversation header's right-hand utilities are a `list` slot, so the
     * key is an `id` of our own rather than a tab key — and it must not collide
     * with a shipped one (`schedule-catalog`, `forge-panel`, …), because reusing
     * one would put this seat *in* that cell instead of beside it.
     */
    const HEADER_ICON_ID = `${PLUGIN_ID}/header`

    /**
     * How many unchanged lines one press on a gap pulls in.
     *
     * 20, which is GitHub's own limit for a context request. Smaller would make
     * a long gap tedious to open; larger would make one press a bigger change
     * than the user asked for, on a control they will press again if they want
     * more.
     */
    const GAP_STEP = 20

    /**
     * Copy.
     *
     * This inline pair is the fallback for a composition without the locale
     * service (the browser harness is one), and it is also what gets registered
     * with the service when there is one. `test/check.mjs` compares both
     * dictionaries against `locale/zh.json` and `locale/en.json` so a key added
     * here cannot silently miss the shipped files.
     */
    const ZH = {
      'meta.title': 'Git 栏（轻量）',
      'meta.description': 'GitHub Desktop 风格的 Git 面板：变更文件、勾选提交、舍弃进回收站、Commit and Push、diff 预览。',

      'panel.title': 'Git',
      'panel.open': '打开 Git 面板',
      'panel.changes': '{n} 个更改',
      'guide.title': 'Git 更改',
      'guide.description': '查看改动、勾选要提交的文件、写 Summary 并提交或推送；双击文件看 diff。',

      'state.loading': '正在读取仓库…',
      'state.retry': '重试',

      'action.fetch': 'Fetch',
      'action.push': 'Push',
      'action.publish': 'Publish',
      'action.refresh': '刷新',
      'action.trash': '打开回收站',
      'action.rebind': '换绑仓库',
      'action.unbind': '解除绑定',
      'action.unbindHere': '这个工作区本身就是仓库，不用解绑',
      'action.busy': '正在{doing}…',

      // What the header's spinner says it is doing, one verb per busy kind. The
      // header shows the spinner in place of the tools whenever an action holds
      // the panel (see `busyVerbKey`), so every kind `setBusy` can be given needs
      // a sentence here — a missing one would render as an empty tooltip.
      'doing.fetch': 'Fetch',
      'doing.push': 'Push',
      'doing.commit': 'Commit',
      'doing.discard': '舍弃',
      'doing.stage': '暂存',
      'doing.bind': '换绑仓库',
      'doing.script': '运行脚本',
      'doing.refresh': '刷新',
      'action.discard': '舍弃这个文件的更改',
      'action.discardAll': '全部舍弃',
      'action.cancel': '取消',
      'action.confirm': '舍弃',
      'action.delete': '删除这条记录',
      'action.restore': '恢复这条更改',
      'action.clear': '清空回收站',
      'fetch.last': '上次 Fetch：{when}',
      'fetch.never': '还没 Fetch 过',

      'status.added': '新增',
      'status.modified': '修改',
      'status.deleted': '删除',
      'status.renamed': '重命名',
      'status.conflicted': '冲突',

      'changes.title': '更改',
      'changes.empty': '工作区干净，没有要提交的更改。',
      'changes.summary': '{files} 个文件 · 已勾选 {staged}',
      'changes.selectAll': '全选（冲突文件除外）',
      'changes.unselectAll': '取消全选',

      'commit.summaryPlaceholder': 'Summary（必填）',
      'commit.descriptionPlaceholder': 'Description（可选）',
      'commit.expand': '展开 Description',
      'commit.collapse': '收起 Description',
      'commit.runScript': '用脚本填 Summary',
      'commit.scriptToggle': '填 Summary 的脚本',
      'commit.scriptPlaceholder': '例：grep -m1 \'^## \' CHANGELOG.md | sed \'s/^## //\'\n输出即 Summary；单独一行 --- 之后算 Description',
      'commit.scriptHint': '以仓库根为工作目录运行',
      'commit.scriptSave': '保存',
      'commit.scriptRun': '运行并填入',
      'commit.commit': 'Commit',
      'commit.commitAndPush': 'Commit and Push',
      'commit.needsSummary': '先写 Summary',
      'commit.needsStaged': '先勾选要提交的文件',

      'discard.one': '舍弃「{path}」的更改？',
      'discard.all': '舍弃全部 {files} 个文件的更改？',
      'discard.more': '还有 {n} 个…',
      'discard.hard': '彻底删除（不存入回收站）',
      'discard.keep': '这次的 diff 会存进插件的回收站，之后还能回看是改了什么。',
      'discard.hardHint': '这次不会留下任何记录，舍弃之后就找不回来了。',

      'bind.title': '这个工作区不是 Git 仓库',
      'bind.hint': '选择一个要绑定的仓库；绑定会记住，下次打开这个工作区还是它。',
      'bind.pathPlaceholder': '也可以直接填一个仓库目录的绝对路径',
      'bind.bind': '绑定',
      'bind.bindPath': '绑定这个路径',
      'bind.rescan': '重新扫描',
      'bind.scanning': '正在扫描…',
      'bind.noCandidates': '工作区里（3 层以内）没找到 Git 仓库，直接填路径吧。',
      'bind.truncated': '目录太多，扫描提前停止了。',
      'bind.current': '已绑定：{path}',

      'trash.title': '回收站',
      'trash.empty': '回收站是空的。被舍弃的更改会连同当时的 diff 一起存在这里。',
      'trash.count': '{n} 条记录',
      'trash.scope.file': '单个文件',
      'trash.scope.all': '全部更改',
      'trash.base': '基于 {commit}',
      'trash.detail': '{files} 个文件 · +{added} −{deleted}',
      'trash.showAll': '显示全部仓库',
      'trash.onlyThis': '只看这个仓库',
      'trash.clearConfirm': '清空 {n} 条回收站记录？',
      'trash.clearHint': '这只是删掉归档的 diff，不会影响已经还原的工作区。',
      'trash.restoreChanged': '舍弃之后这些文件又改过了，恢复会盖掉后来的改动。',
      'trash.restoreMoved': '这条记录基于的提交已经不是当前版本，先切回那个版本再恢复。',
      'trash.restoreTruncated': '这条 diff 在归档时被截断了，恢复出来会缺内容。',
      'trash.restoreBinary': '二进制文件的 diff 里没有内容，没法重放。',
      'trash.restoreNoDiff': '这条记录里没有可应用的 diff。',
      'trash.restoreOtherRepo': '这条记录属于另一个仓库。',
      'trash.restoreNoRepo': '当前工作区没有绑定这个仓库。',

      'diff.title': 'Diff',
      'diff.loading': '正在生成 diff…',
      'diff.empty': '没有可显示的 diff。',
      'diff.binary': '二进制文件，不显示内容。',
      'diff.truncated': 'diff 太长，已截断。',
      'diff.trashEntry': '回收站记录',
      'diff.headerAdd': '新增文件',
      'diff.headerDelete': '删除文件',
      'diff.headerRename': '重命名',
      'diff.headerMode': '权限变更',
      'diff.headerBinary': '二进制',
      'diff.headerShow': '展开这行原始 diff',
      'diff.headerHide': '收起这行原始 diff',
      'diff.noNewline': '文件末尾没有换行',
      'diff.hideWhitespace': '不看空白改动',
      'diff.gapHidden': '{n} 行未改动',
      'diff.gapRemaining': '还有 {n} 行',
      'diff.gapDown': '从上往下展开 {n} 行',
      'diff.gapUp': '从下往上展开 {n} 行',

      // Opening a file in the user's own program. The three built-in names are
      // the panel's copy, not the host's — the host sends an id.
      'open.action': '用 {app} 打开',
      'open.choose': '换一个程序打开',
      'open.done': '已用 {app} 打开',
      'open.default': '系统默认程序',
      'open.notepad': '记事本',
      'open.editor': '文本编辑器',
      'open.reveal': '在文件夹中显示',

      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',

      'err.E_BAD_REQUEST': '请求不合法。',
      'err.E_UNKNOWN_ACTION': '宿主不认识这个操作（插件版本可能不一致）。',
      'err.E_NO_WORKSPACE': '拿不到这个会话的工作区目录。',
      'err.E_NO_REPO': '还没有绑定 Git 仓库。',
      'err.E_NO_GIT': '本机找不到 git 可执行文件。装一个 Git，或在插件设置里指定 gitPath。',
      'err.E_EMPTY_SUMMARY': 'Summary 不能为空。',
      'err.E_NOTHING_STAGED': '没有勾选任何改动。',
      'err.E_CONFLICT': '仓库里有未解决的冲突，先解决它们。',
      'err.E_GIT_FAILED': 'git 命令失败了。',
      'err.E_NO_REMOTE': '这个仓库没有配置远端（remote）。',
      'err.E_NO_UPSTREAM': '这个分支还没有上游。',
      'err.E_AUTH': '推送认证失败：本机 git 没有可用凭据。先在终端里成功 push 一次。',
      'err.E_PUSH_REJECTED': '推送被拒绝：远端有你本地没有的提交，先 Fetch 再推。',
      'err.E_TRASH_NOT_FOUND': '这条回收站记录已经不在了。',
      'err.E_TRASH_NOT_RESTORABLE': '这条记录现在不能恢复。',
      'err.E_NO_FILE': '工作区里已经没有这个文件了（可能刚被删掉或舍弃）。',
      'err.E_NO_OPENER': '这个程序启动不了，检查一下设置里的命令。',
      'err.E_INTERNAL': '插件内部出错了。',
      'err.E_UNKNOWN': '操作失败。',

      'toast.committed': '已提交 {commit}',
      'toast.pushed': '已推送',
      'toast.published': '已发布到这个远端',
      'toast.fetched': '已 Fetch',
      'toast.refreshed': '已刷新',
      'toast.discarded': '已舍弃 {n} 个文件的更改',
      'toast.trashed': '已舍弃 {n} 个文件，diff 存进了回收站',
      'toast.bound': '已绑定这个仓库',
      'toast.unbound': '已解除绑定',
      'toast.trashCleared': '回收站已清空（{n} 条）',
      'toast.trashDeleted': '已删除那条记录',
      'toast.trashRestored': '已恢复 {n} 个文件的更改并勾选，这条记录已用完并从回收站移除',
      'toast.scriptFailed': '脚本退出码 {code}',
      'toast.scriptSaved': '脚本已保存',
      'toast.scriptSaveFailed': '脚本没能保存，再点一次保存试试',
      'toast.scriptFilled': '已按脚本填入 Summary',
      'toast.pushFailed': '已提交 {commit}，但推送失败',
    }

    const EN = {
      'meta.title': 'Git Bar (lite)',
      'meta.description': 'A GitHub Desktop-style Git panel: changed files, tick-to-stage, commit, commit and push, discard into a trash, and diff preview.',

      'panel.title': 'Git',
      'panel.open': 'Open the Git panel',
      'panel.changes': '{n} changes',
      'guide.title': 'Git changes',
      'guide.description': 'Review changes, tick what to commit, write a Summary and commit or push; double-click a file for its diff.',

      'state.loading': 'Reading the repository…',
      'state.retry': 'Retry',

      'action.fetch': 'Fetch',
      'action.push': 'Push',
      'action.publish': 'Publish',
      'action.refresh': 'Refresh',
      'action.trash': 'Open the trash',
      'action.rebind': 'Change repository',
      'action.unbind': 'Unbind',
      'action.unbindHere': 'This workspace is the repository itself — nothing to unbind',
      'action.busy': '{doing}…',
      'doing.fetch': 'Fetching',
      'doing.push': 'Pushing',
      'doing.commit': 'Committing',
      'doing.discard': 'Discarding',
      'doing.stage': 'Staging',
      'doing.bind': 'Binding',
      'doing.script': 'Running the script',
      'doing.refresh': 'Refreshing',
      'action.discard': 'Discard this file’s changes',
      'action.discardAll': 'Discard all',
      'action.cancel': 'Cancel',
      'action.confirm': 'Discard',
      'action.delete': 'Delete this entry',
      'action.restore': 'Restore this change',
      'action.clear': 'Empty the trash',
      'fetch.last': 'Last fetch: {when}',
      'fetch.never': 'Never fetched',

      'status.added': 'Added',
      'status.modified': 'Modified',
      'status.deleted': 'Deleted',
      'status.renamed': 'Renamed',
      'status.conflicted': 'Conflicted',

      'changes.title': 'Changes',
      'changes.empty': 'The working tree is clean — nothing to commit.',
      'changes.summary': '{files} files · {staged} ticked',
      'changes.selectAll': 'Tick everything (conflicts excluded)',
      'changes.unselectAll': 'Untick everything',

      'commit.summaryPlaceholder': 'Summary (required)',
      'commit.descriptionPlaceholder': 'Description (optional)',
      'commit.expand': 'Show the Description field',
      'commit.collapse': 'Hide the Description field',
      'commit.runScript': 'Fill the Summary from the script',
      'commit.scriptToggle': 'Script that fills the Summary',
      'commit.scriptPlaceholder': "e.g. grep -m1 '^## ' CHANGELOG.md | sed 's/^## //'\nIts output is the Summary; a line reading --- starts the Description",
      'commit.scriptHint': 'Runs with the repository root as its working directory',
      'commit.scriptSave': 'Save',
      'commit.scriptRun': 'Run and fill',
      'commit.commit': 'Commit',
      'commit.commitAndPush': 'Commit and Push',
      'commit.needsSummary': 'Write a Summary first',
      'commit.needsStaged': 'Tick a file first',

      'discard.one': 'Discard the changes to “{path}”?',
      'discard.all': 'Discard the changes to all {files} files?',
      'discard.more': 'and {n} more…',
      'discard.hard': 'Delete for good (keep no copy)',
      'discard.keep': 'This diff is stored in the plugin’s trash, so you can still see what was discarded.',
      'discard.hardHint': 'Nothing is kept. Once discarded, this change cannot be recovered.',

      'bind.title': 'This workspace is not a Git repository',
      'bind.hint': 'Pick a repository to bind. The binding is remembered, so this workspace opens on it next time too.',
      'bind.pathPlaceholder': 'Or type the absolute path of a repository',
      'bind.bind': 'Bind',
      'bind.bindPath': 'Bind this path',
      'bind.rescan': 'Scan again',
      'bind.scanning': 'Scanning…',
      'bind.noCandidates': 'No Git repository found within three levels; type a path instead.',
      'bind.truncated': 'There were too many directories, so the scan stopped early.',
      'bind.current': 'Bound to {path}',

      'trash.title': 'Trash',
      'trash.empty': 'The trash is empty. Discarded changes are archived here with the diff they had at the time.',
      'trash.count': '{n} entries',
      'trash.scope.file': 'one file',
      'trash.scope.all': 'all changes',
      'trash.base': 'against {commit}',
      'trash.detail': '{files} files · +{added} −{deleted}',
      'trash.showAll': 'Show every repository',
      'trash.onlyThis': 'Only this repository',
      'trash.clearConfirm': 'Empty {n} trash entries?',
      'trash.clearHint': 'This only deletes the archived diffs; the restored working tree is untouched.',
      'trash.restoreChanged': 'These files changed after the discard; restoring would overwrite newer work.',
      'trash.restoreMoved': 'The commit this entry was taken against is no longer the current one; check it out first.',
      'trash.restoreTruncated': 'This diff was truncated when archived, so restoring it would be incomplete.',
      'trash.restoreBinary': 'A binary change has no content in its diff, so it cannot be replayed.',
      'trash.restoreNoDiff': 'This entry has no diff to apply.',
      'trash.restoreOtherRepo': 'This entry belongs to a different repository.',
      'trash.restoreNoRepo': 'This workspace is not bound to that repository.',

      'diff.title': 'Diff',
      'diff.loading': 'Building the diff…',
      'diff.empty': 'There is no diff to show.',
      'diff.binary': 'Binary file — contents not shown.',
      'diff.truncated': 'The diff was too long and has been truncated.',
      'diff.trashEntry': 'Trash entry',
      'diff.headerAdd': 'New file',
      'diff.headerDelete': 'Deleted file',
      'diff.headerRename': 'Renamed',
      'diff.headerMode': 'Mode changed',
      'diff.headerBinary': 'Binary',
      'diff.headerShow': 'Show this raw diff line',
      'diff.headerHide': 'Hide this raw diff line',
      'diff.noNewline': 'No newline at the end of the file',
      'diff.hideWhitespace': 'Hide whitespace',
      'diff.gapHidden': '{n} unchanged lines',
      'diff.gapRemaining': '{n} more',
      'diff.gapDown': 'Show {n} more lines from above',
      'diff.gapUp': 'Show {n} more lines from below',

      // Opening a file in the user's own program — the client's copy for the
      // three built-ins, because the host only names an id.
      'open.action': 'Open with {app}',
      'open.choose': 'Open with a different program',
      'open.done': 'Opened with {app}',
      'open.default': 'system default',
      'open.notepad': 'Notepad',
      'open.editor': 'Text editor',
      'open.reveal': 'Show in folder',

      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',

      'err.E_BAD_REQUEST': 'The request was not valid.',
      'err.E_UNKNOWN_ACTION': 'The host does not know that action (plugin versions may not match).',
      'err.E_NO_WORKSPACE': 'This session has no workspace directory to look in.',
      'err.E_NO_REPO': 'No Git repository is bound yet.',
      'err.E_NO_GIT': 'No git executable was found. Install Git, or set gitPath in the plugin settings.',
      'err.E_EMPTY_SUMMARY': 'The Summary cannot be empty.',
      'err.E_NOTHING_STAGED': 'Nothing is ticked.',
      'err.E_CONFLICT': 'The repository has unresolved conflicts; resolve them first.',
      'err.E_GIT_FAILED': 'A git command failed.',
      'err.E_NO_REMOTE': 'This repository has no remote configured.',
      'err.E_NO_UPSTREAM': 'This branch has no upstream yet.',
      'err.E_AUTH': 'Push authentication failed: the local git has no usable credential. Push once from a terminal first.',
      'err.E_PUSH_REJECTED': 'The push was rejected: the remote has commits you do not. Fetch, then push.',
      'err.E_TRASH_NOT_FOUND': 'That trash entry is gone.',
      'err.E_TRASH_NOT_RESTORABLE': 'This entry cannot be restored right now.',
      'err.E_NO_FILE': 'That file is no longer in the working tree (it may have just been deleted or discarded).',
      'err.E_NO_OPENER': 'That program could not be started — check the command in the settings.',
      'err.E_INTERNAL': 'The plugin hit an internal error.',
      'err.E_UNKNOWN': 'The operation failed.',

      'toast.committed': 'Committed {commit}',
      'toast.pushed': 'Pushed',
      'toast.published': 'Published this branch to the remote',
      'toast.fetched': 'Fetched',
      'toast.refreshed': 'Refreshed',
      'toast.discarded': 'Discarded the changes to {n} files',
      'toast.trashed': 'Discarded {n} files; the diff went to the trash',
      'toast.bound': 'Bound to that repository',
      'toast.unbound': 'Binding cleared',
      'toast.trashCleared': 'Trash emptied ({n} entries)',
      'toast.trashDeleted': 'Entry deleted',
      'toast.trashRestored': 'Restored and ticked the changes to {n} files; this entry is used up and removed',
      'toast.scriptFailed': 'The script exited with {code}',
      'toast.scriptSaved': 'Script saved',
      'toast.scriptSaveFailed': 'The script could not be saved. Press Save again.',
      'toast.scriptFilled': 'Filled the Summary from the script',
      'toast.pushFailed': 'Committed {commit}, but the push failed',
    }

    /** Interpolate `{name}` placeholders; the one syntax the locale service has. */
    function interpolate(template, params) {
      if (params === undefined) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      )
    }

    /** `true` when the browser is set to Chinese, for the no-locale-service case. */
    function prefersChinese() {
      const tag = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '')
      return tag.toLowerCase().startsWith('zh')
    }

    /** The translate function used when the locale service is absent. */
    function fallbackTranslate() {
      const table = prefersChinese() ? ZH : EN
      return (key, params) => interpolate(Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key, params)
    }

    /** The host's own message for a code, or its text, or the raw code. */
    function errorText(t, code, fallback) {
      const key = `err.${code}`
      const localised = t(key)
      if (localised !== key) return localised
      return typeof fallback === 'string' && fallback !== '' ? fallback : code
    }

    /**
     * What one program is called in the open-with menu.
     *
     * The host sends an id for the platform's own entries and a label for the
     * entries the user wrote, so this is the one place that decides which is
     * which: a known id is translated, anything else keeps its own name, and an
     * id nobody can name falls back to the id itself rather than to an empty row.
     * "Does `t` know this key" is the same test `errorText` makes, for the same
     * reason — a translator that is missing a key answers with the key.
     */
    function openerName(t, opener) {
      const id = typeof opener?.id === 'string' ? opener.id : ''
      const key = `open.${id}`
      const localised = t(key)
      if (localised !== key) return localised
      if (typeof opener?.label === 'string' && opener.label.trim() !== '') return opener.label
      return id
    }

    /* ------------------------------------------------------------------ *
     * 3. Small pure helpers (covered by the unit tests)
     * ------------------------------------------------------------------ */

    /**
     * Which mark the row shows for a change.
     *
     * Five kinds, not the seven git reports. GitHub Desktop maps a new file and
     * an untracked one to the same `diff-added` mark (`iconForStatus` in
     * `app/src/ui/octicons/status.ts`), and this panel follows it: "tracked or
     * not" is a distinction git cares about when *staging*, not one worth two
     * different marks in a list of what changed.
     */
    function statusKind(file) {
      if (file === null || typeof file !== 'object') return 'modified'
      if (file.conflicted === true) return 'conflicted'
      if (file.kind === 'deleted') return 'deleted'
      if (file.kind === 'renamed') return 'renamed'
      if (file.kind === 'added' || file.kind === 'untracked' || file.untracked === true) return 'added'
      return 'modified'
    }

    /** The component that draws one of those marks. */
    function statusGlyph(kind) {
      if (kind === 'added') return StatusAddedGlyph
      if (kind === 'deleted') return StatusDeletedGlyph
      if (kind === 'renamed') return StatusRenamedGlyph
      if (kind === 'conflicted') return StatusConflictGlyph
      return StatusModifiedGlyph
    }

    /** Split a repository path into the directory part and the file name. */
    function splitPath(path) {
      const text = String(path ?? '')
      const cut = text.lastIndexOf('/')
      return cut < 0 ? { dir: '', name: text } : { dir: text.slice(0, cut + 1), name: text.slice(cut + 1) }
    }

    /**
     * Classify the lines of a unified diff for rendering.
     *
     * Line numbers are tracked from each `@@` header so the gutter can show the
     * old and new line for every row, which is most of what makes a diff
     * readable.
     *
     * The mechanical part of the format is folded into the file header rather
     * than printed: `diff --git`, `index`, `---`/`+++`, `new file mode`, `rename
     * from`/`rename to` and the `Binary files … differ` line are how git *encodes*
     * a change, not what the change *is*. They become one `file` row per file
     * carrying `path`, `origPath` and a `badge` (`added`/`deleted`/`renamed`/
     * `binary`/`mode`), which is what the tab draws as a card. Every one of those
     * raw lines is still reachable — each file row keeps them in `raw` — because
     * a renderer that quietly dropped information would make the panel's only
     * record of a discarded change incomplete.
     *
     * `hunk` rows carry the section heading (the text after the second `@@`) in
     * `section`, so a hunk can read as `function render() {` instead of as
     * `@@ -12,7 +12,9 @@ function render() {`.
     *
     * @returns {{
     *   kind: string, text: string, oldLine?: number, newLine?: number,
     *   path?: string, origPath?: string, badge?: string,
     *   raw?: string[], section?: string, goto?: number,
     * }[]}
     */
    function diffRows(text) {
      const source = typeof text === 'string' ? text : ''
      if (source === '') return []
      const lines = source.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

      const rows = []
      let oldLine = 0
      let newLine = 0
      let inHunk = false
      // The file header being accumulated: every meta line up to the first `@@`
      // belongs to it, and is folded into one row when the hunk (or the next
      // file) starts.
      let pending = null

      const badgeOf = (raw) => {
        for (const line of raw) {
          if (line.startsWith('new file mode')) return 'added'
          if (line.startsWith('deleted file mode')) return 'deleted'
          if (line.startsWith('rename from') || line.startsWith('copy from')) return 'renamed'
          if (line.startsWith('Binary files ') || line === 'GIT binary patch') return 'binary'
          if (line.startsWith('old mode') || line.startsWith('new mode')) return 'mode'
        }
        return undefined
      }

      const flush = () => {
        if (pending === null) return
        const row = { kind: 'file', text: pending.text, path: pending.path }
        if (pending.origPath !== undefined) row.origPath = pending.origPath
        const badge = badgeOf(pending.raw)
        if (badge !== undefined) row.badge = badge
        // Kept for the "show the raw lines" disclosure. A file with nothing but a
        // `diff --git` and an `index` line — a pure mode change or a pure rename —
        // has nothing worth hiding either, so the raw list is what is left.
        row.raw = pending.raw
        rows.push(row)
        pending = null
      }

      for (const line of lines) {
        if (line.startsWith('diff --git ')) {
          flush()
          inHunk = false
          const body = line.slice('diff --git '.length)
          const halves = body.split(' ')
          const right = halves.length >= 2 ? halves[halves.length - 1] : body
          const left = halves.length >= 2 ? halves[0] : undefined
          pending = {
            text: line,
            path: right.startsWith('b/') ? right.slice(2) : right,
            raw: [line],
          }
          // A rename's old path, when the `diff --git` line has both halves. The
          // `rename from`/`rename to` lines below override it with git's own
          // spelling, which is the authoritative one.
          if (left !== undefined && left.startsWith('a/') && left.slice(2) !== pending.path) {
            pending.origPath = left.slice(2)
          }
          continue
        }
        if (line.startsWith('@@')) {
          flush()
          const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
          if (match !== null) {
            oldLine = Number(match[1])
            newLine = Number(match[2])
          }
          inHunk = true
          const section = match === null ? '' : match[3].trim()
          const hunk = { kind: 'hunk', text: line }
          if (section !== '') hunk.section = section
          rows.push(hunk)
          continue
        }
        if (!inHunk) {
          if (pending !== null) {
            pending.raw.push(line)
            if (line.startsWith('rename from ')) pending.origPath = line.slice('rename from '.length)
            else if (line.startsWith('rename to ')) pending.path = line.slice('rename to '.length)
            else if (line.startsWith('+++ ')) {
              const target = line.slice(4).split('\t')[0]
              if (target !== '/dev/null' && target.startsWith('b/')) pending.path = target.slice(2)
            }
            continue
          }
          // A `---`/`+++` block or mode line with no `diff --git` in front of it —
          // the tail of a hand-written patch. It stays a plain meta row.
          rows.push({ kind: 'meta', text: line })
          continue
        }
        if (line.startsWith('+')) {
          rows.push({ kind: 'add', text: line.slice(1), newLine })
          newLine += 1
          continue
        }
        if (line.startsWith('-')) {
          rows.push({ kind: 'del', text: line.slice(1), oldLine })
          oldLine += 1
          continue
        }
        if (line.startsWith('\\')) {
          // `\ No newline at end of file` is about the line above it, not a line
          // of its own. It is attached to that row so the tab can draw it as a
          // note *on* the row instead of as a stray paragraph between two lines.
          const marker = line.slice(1).trim()
          const above = rows.length === 0 ? undefined : rows[rows.length - 1]
          if (above !== undefined && (above.kind === 'add' || above.kind === 'del' || above.kind === 'ctx' || above.kind === 'note')) {
            if (above.kind === 'note') continue
            above.noNewline = marker
          } else {
            rows.push({ kind: 'note', text: marker, noNewline: marker })
          }
          continue
        }
        const content = line.startsWith(' ') ? line.slice(1) : line
        rows.push({ kind: 'ctx', text: content, oldLine, newLine })
        oldLine += 1
        newLine += 1
      }
      flush()
      return rows
    }

    /**
     * A coarse relative time, localized by the copy table.
     *
     * @param {string} at ISO timestamp
     * @param {number} now epoch milliseconds
     * @param {(key: string, params?: object) => string} t
     */
    function formatRelative(at, now, t) {
      const when = Date.parse(String(at ?? ''))
      if (!Number.isFinite(when)) return ''
      const seconds = Math.max(0, Math.round((Number(now) - when) / 1000))
      if (seconds < 90) return t('time.now')
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return t('time.minutes', { n: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return t('time.hours', { n: hours })
      const days = Math.round(hours / 24)
      if (days <= 30) return t('time.days', { n: days })
      try {
        return new Date(when).toLocaleDateString()
      } catch {
        return String(at)
      }
    }

    /**
     * "Last fetch: 3 min ago", or a plain "never" when there is no fetch to
     * report.
     *
     * The timestamp is git's own — the mtime of `.git/FETCH_HEAD` — not something
     * this plugin writes down, so a fetch run in a terminal counts too and the
     * answer survives a restart.
     *
     * @param {object | null} state the status payload
     * @param {number} now epoch milliseconds
     * @param {(key: string, params?: object) => string} t
     */
    function lastFetchLabel(state, now, t) {
      const at = state === null || typeof state !== 'object' ? null : state.lastFetchAt
      const when = formatRelative(at, now, t)
      return when === '' ? t('fetch.never') : t('fetch.last', { when })
    }

    /**
     * Why restoring is unavailable for one entry, in one sentence.
     *
     * The reasons come from the host (`canRestore`), which is the only side that
     * can compare the archive's base against the current tree. Anything
     * unrecognised falls back to a general statement rather than a blank line.
     */
    function restoreReasonText(t, reason) {
      if (reason === 'changed') return t('trash.restoreChanged')
      // The commit the diff was cut against is no longer HEAD.
      if (reason === 'moved') return t('trash.restoreMoved')
      if (reason === 'other-repo') return t('trash.restoreOtherRepo')
      if (reason === 'no-repo') return t('trash.restoreNoRepo')
      // The diff itself cannot be replayed.
      if (reason === 'truncated') return t('trash.restoreTruncated')
      if (reason === 'binary') return t('trash.restoreBinary')
      return t('trash.restoreNoDiff')
    }

    /**
     * Split a script's output into the Summary and the Description.
     *
     * Everything it printed is the Summary, so a script that knows nothing about
     * this still fills the box usefully. A line reading exactly `---` is the one
     * way to say "the rest is the body": it is three characters a shell script
     * can print, it cannot collide with prose the way a heading might, and it is
     * already the separator Markdown and YAML front-matter use.
     *
     * @param {string} stdout
     * @returns {{ summary: string, description: string }}
     */
    function splitScriptOutput(stdout) {
      const text = typeof stdout === 'string' ? stdout : ''
      const lines = text.split(/\r?\n/)
      const marker = lines.findIndex((line) => line.trim() === '---')
      if (marker === -1) {
        const copy = [...lines]
        while (copy.length > 0 && copy[copy.length - 1].trim() === '') copy.pop()
        return { summary: copy.join('\n'), description: '' }
      }
      const before = lines.slice(0, marker)
      while (before.length > 0 && before[before.length - 1].trim() === '') before.pop()
      return { summary: before.join('\n'), description: lines.slice(marker + 1).join('\n').replace(/^\n+/, '') }
    }

    /**
     * The paths the user has ticked, out of a status payload.
     *
     * GitHub Desktop's model, which this panel now follows: a tick is a *choice*
     * about the next commit, kept by the panel, not a `git add`. So the payload
     * carries no per-file tick of its own — the panel decides, and the file list
     * only says what changed.
     *
     * @param {object | null} state the status payload
     * @param {Set<string>} excluded paths the user has unticked
     * @returns {string[]}
     */
    function tickedPaths(state, excluded) {
      if (state === null || !Array.isArray(state.files)) return []
      return state.files
        .filter((file) => file.conflicted !== true && !(excluded !== undefined && excluded.has(file.path)))
        .map((file) => file.path)
    }

    /** How many of a status payload's files are ticked and commit-ready. */
    function stagedCount(state, excluded) {
      return tickedPaths(state, excluded).length
    }

    /**
     * The paths a tick can mean something for.
     *
     * A conflicted file is excluded: committing it would record a resolution
     * nobody made. A "select all" that quietly claimed otherwise would be worse
     * than no button.
     *
     * @param {object | null} state the status payload
     * @returns {string[]}
     */
    function selectablePaths(state) {
      if (state === null || !Array.isArray(state.files)) return []
      return state.files.filter((file) => file.conflicted !== true).map((file) => file.path)
    }

    /**
     * What the header's select-all box should show: `'none'`, `'some'`, `'all'`,
     * or `'empty'` when there is nothing a tick could do.
     *
     * A tri-state box rather than a button, because the question it answers is
     * the same one each row's tick answers, and the header is where a user looks
     * to find out "is everything ticked".
     */
    function selectionState(state, excluded) {
      const selectable = selectablePaths(state)
      if (selectable.length === 0) return 'empty'
      const ticked = stagedCount(state, excluded)
      if (ticked === 0) return 'none'
      if (ticked >= selectable.length) return 'all'
      return 'some'
    }

    /** Whether a status payload has anything that cannot be committed as-is. */
    function hasConflict(state) {
      return state !== null && (state.counts?.conflicted ?? 0) > 0
    }

    /** The label the single context button wears, from the branch state. */
    function contextLabelKey(state) {
      if (state === null) return 'action.fetch'
      if (state.primary === PRIMARY.PUSH) return 'action.push'
      if (state.primary === PRIMARY.PUBLISH) return 'action.publish'
      return 'action.fetch'
    }

    /** The action the single context button performs. */
    function contextAction(state) {
      return state !== null && state.primary === PRIMARY.PUSH ? ACTIONS.PUSH : ACTIONS.FETCH
    }

    /**
     * What the header says while an action holds the panel, e.g. "正在 Fetch…".
     *
     * `busy` is the name `run` was given, not the wire action, so the table is
     * keyed by those names. Anything unrecognised — a kind added later and not
     * given copy yet — falls back to the bare spinner with no sentence, rather
     * than to a raw key the user would see as `doing.undefined`.
     *
     * @param {string | null} busy the kind passed to `setBusy`
     * @param {(key: string, params?: object) => string} t
     * @returns {string} a sentence, or `''` when there is nothing honest to say
     */
    function busyLabel(busy, t) {
      if (typeof busy !== 'string' || busy === '') return ''
      const key = `doing.${busy}`
      const doing = t(key)
      // The translator falls back to the key itself when it has no copy, and a
      // key-shaped answer is not a sentence: show the spinner alone instead.
      if (typeof doing !== 'string' || doing === key) return ''
      return t('action.busy', { doing })
    }

    /**
     * Whether the commit buttons may be pressed, and why not when they may not.
     *
     * Extracted from the component so the rule can be asserted without a DOM: a
     * commit needs a Summary and at least one ticked, non-conflicted file, and
     * nothing else may be in flight. The host enforces the same rules again —
     * this is only what makes the button honest.
     *
     * @returns {{ canCommit: boolean, reasonKey: string | null }}
     */
    function commitReadiness(state, summary, busy, excluded) {
      const ready = stagedCount(state, excluded)
      if (hasConflict(state)) return { canCommit: false, reasonKey: 'err.E_CONFLICT' }
      if (String(summary ?? '').trim() === '') return { canCommit: false, reasonKey: 'commit.needsSummary' }
      if (ready === 0) return { canCommit: false, reasonKey: 'commit.needsStaged' }
      if (busy !== null && busy !== undefined) return { canCommit: false, reasonKey: null }
      return { canCommit: true, reasonKey: null }
    }

    /* ------------------------------------------------------------------ *
     * 4. Icons — the host's own artwork, copied path for path
     * ------------------------------------------------------------------ */

    /**
     * Build an icon on the host's 16×16 / currentColor grid.
     *
     * The host puts `stroke-width` on the `<svg>` and `stroke="currentColor"` on
     * each path; `getComputedStyle(svg).stroke` is `none`, so the path is where
     * the colour actually lives. `Regular` weight is 1.
     */
    function artwork(viewBox, paths, circles) {
      const Ink = ({ size = 16, className, strokeWidth }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            className,
            viewBox,
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true',
            strokeWidth: strokeWidth === undefined ? 1 : strokeWidth,
          },
          [
            ...paths.map((d, index) => h('path', { key: `p${index}`, d, stroke: 'currentColor' })),
            ...circles.map((circle, index) =>
              h('circle', {
                key: `c${index}`,
                cx: circle.cx,
                cy: circle.cy,
                r: circle.r,
                stroke: 'currentColor',
              }),
            ),
          ],
        )
      return Ink
    }

    /**
     * The same box, for artwork that is filled rather than stroked.
     *
     * The status marks are GitHub Desktop's own `diff-*` octicons
     * (`app/src/ui/octicons/status.ts` `iconForStatus`), and each is a single
     * filled path whose sub-paths draw both the frame and the mark inside it.
     * Stroking one would draw the outline of an outline, so this variant puts
     * `fill="currentColor"` on the path and leaves the box `fill="none"`, which
     * is the filled twin of the rule above.
     *
     * These are deliberately *not* DSH's artwork: DSH has no changed-file status
     * marks to copy, and the panel is meant to read like GitHub Desktop. The
     * paths below are the octicon sources verbatim.
     */
    function filledArtwork(viewBox, paths) {
      const Ink = ({ size = 16, className }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            className,
            viewBox,
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true',
          },
          paths.map((d, index) => h('path', { key: `f${index}`, d, fill: 'currentColor' })),
        )
      return Ink
    }

    /** `diff-added` — a new file, and an untracked one, exactly as Desktop draws them. */
    const StatusAddedGlyph = filledArtwork('0 0 16 16', [
      'M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm10.5 1.5H2.75a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z',
    ])

    /** `diff-modified`. */
    const StatusModifiedGlyph = filledArtwork('0 0 16 16', [
      'M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
    ])

    /** `diff-removed`. */
    const StatusDeletedGlyph = filledArtwork('0 0 16 16', [
      'M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm8.5 6.25h-6.5a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5Z',
    ])

    /** `diff-renamed`. */
    const StatusRenamedGlyph = filledArtwork('0 0 16 16', [
      'M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm9.03 6.03-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H4.75a.75.75 0 0 1 0-1.5h4.69L7.47 5.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l3.25 3.25a.75.75 0 0 1 0 1.06Z',
    ])

    /** `alert`. */
    const StatusConflictGlyph = filledArtwork('0 0 16 16', [
      'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    ])

    /** `IconBranchOutlineRegular` — the panel's own mark. */
    const GitGlyph = artwork(
      '0 0 16 16',
      [
        'M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564',
        'M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944',
      ],
      [
        { cx: 12.4502, cy: 3.3079, r: 1.56962 },
        { cx: 12.4502, cy: 12.6921, r: 1.56962 },
      ],
    )

    /**
     * The unbind mark: two link loops pulled apart.
     *
     * The header used to use `GitGlyph` for "Change repository", which was wrong
     * twice over — a branch says "this repository", not "stop looking at it", and
     * the very same glyph is the trash tab's and the guide card's mark, so a user
     * saw one picture mean three things. This is the counterpart of the usual
     * chain-link icon: two capsules, offset diagonally, with a visible gap where
     * they would have joined.
     *
     * Drawn rather than taken, because DSH ships no unlink glyph and its icon set
     * has no chain at all. It follows the house rule (16 box, stroke on the path,
     * `Regular` weight) and was checked at 15px, which is the size the header
     * actually renders: the two loops stay distinguishable there, and one of them
     * alone would not.
     */
    const UnlinkGlyph = artwork(
      '0 0 16 16',
      [
        'M7.1 2.9H4.6A2.9 2.9 0 0 0 4.6 8.7H7.1',
        'M8.9 13.1H11.4A2.9 2.9 0 0 0 11.4 7.3H8.9',
      ],
      [],
    )

    /** `IconTrashOutlineRegular`. */
    const TrashGlyph = artwork(
      '0 0 16 16',
      [
        'M1.28149 3.88831H14.7187',
        'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
        'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
        'M6.44946 6.98926V11.1238',
        'M9.55054 6.98926V11.1238',
      ],
      [],
    )

    /**
     * The restore mark: an arc with a head, drawn to the host's own icon
     * specification (16 box, `stroke` on each path, `Regular` weight).
     *
     * DSH ships no undo/restore glyph to copy — `IconTrashOutlineRegular` is as
     * close as its icon set gets, and that is what the *discard* button already
     * uses, so reusing it for the opposite verb would be actively confusing.
     */
    const RestoreGlyph = artwork('0 0 16 16', [
      'M2.9 7.4A5.1 5.1 0 1 1 7.1 12.3',
      'M2.3 3.6V7.4H6.1',
    ], [])

    /**
     * The script mark: a sparkle, drawn to the same specification.
     *
     * DSH has no "generate" or "wand" glyph to copy, and a chevron would read as
     * "expand" rather than "fill this in", so this is hand-drawn to match the
     * house rule (16 box, `stroke` on each path).
     */
    const WandGlyph = artwork('0 0 16 16', [
      'M6.5 2.5L7.6 5.9L11 7L7.6 8.1L6.5 11.5L5.4 8.1L2 7L5.4 5.9Z',
      'M12.2 9.6L12.8 11.2L14.4 11.8L12.8 12.4L12.2 14L11.6 12.4L10 11.8L11.6 11.2Z',
    ], [])

    /** `IconRefreshOutlineRegular`. */
    const RefreshGlyph = artwork(
      '0 0 16 16',
      [
        'M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1',
        'M14.4999 1.5V5.1H10.8999',
      ],
      [],
    )

    /** `IconCloseOutlineRegular`. */
    const CloseGlyph = artwork('0 0 16 16', ['M2.5 2.5L13.5 13.5', 'M13.5 2.5L2.5 13.5'], [])

    /** `IconCheckOutlineRegular`. */
    const CheckGlyph = artwork(
      '0 0 16 16',
      ['M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4'],
      [],
    )

    /** `IconWarningTriangleOutlineRegular`. */
    const WarningGlyph = artwork(
      '0 0 16 16',
      ['M6.87 2.6a1.33 1.33 0 0 1 2.26 0l5.34 9.33A1.33 1.33 0 0 1 13.33 14H2.67a1.33 1.33 0 0 1-1.14-2.07Z', 'M8 6v3m0 2.33h.01'],
      [],
    )

    /** `IconChevronRightOutlineRegular`. */
    const ChevronRightGlyph = artwork(
      '0 0 16 16',
      ['M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4'],
      [],
    )

    /** The same chevron, turned down: the "more choices" mark beside a button. */
    const ChevronDownGlyph = artwork('0 0 16 16', ['M3.5 6L8 10.5L12.5 6'], [])

    /** The same chevron, turned up: "pull lines down from above this hunk". */
    const ChevronUpGlyph = artwork('0 0 16 16', ['M3.5 10L8 5.5L12.5 10'], [])

    /**
     * Whitespace: two vertical guide bars, the way an editor draws indentation.
     *
     * No crossbar. The first version added a middle horizontal stroke for balance
     * and it read as a `+`/`−` pair — "add a line, remove a line" — which is the
     * opposite of "ignore whitespace". Two plain bars say "indentation" and
     * nothing else.
     */
    const WhitespaceGlyph = artwork('0 0 16 16', ['M5.5 3.5V12.5', 'M10.5 3.5V12.5'], [])

    /**
     * "Open in another program": a frame with an arrow leaving it.
     *
     * Drawn rather than taken, for the same reason `WandGlyph` is: DSH has no
     * "open externally" mark to copy, and this one has to read as *the file
     * leaves the panel* rather than as "expand" (a chevron) or "download".
     */
    const OpenGlyph = artwork(
      '0 0 16 16',
      [
        'M9.4 2.5H13.5V6.6',
        'M13.5 2.5L7.2 8.8',
        'M13.5 9.8V12.6C13.5 13.1 13.1 13.5 12.6 13.5H3.4C2.9 13.5 2.5 13.1 2.5 12.6V3.4C2.5 2.9 2.9 2.5 3.4 2.5H6.2',
      ],
      [],
    )

    /**
     * The guide card's mark.
     *
     * The card renders its icon at 22–26px. A 16px grid scaled up would thicken
     * the 1px stroke with it, so the stroke is divided by the size ratio to keep
     * the optical weight the same as a real 16px icon.
     */
    const GuideGlyph = ({ size = 26, className }) =>
      h(GitGlyph, { size, className, strokeWidth: 16 / size })

    /* ------------------------------------------------------------------ *
     * 5. Styles
     * ------------------------------------------------------------------ */

    const STYLE_ATTR = 'data-lite-git-style'

    /**
     * Tokens only, each with a light fallback, plus the panel's own dimensions.
     *
     * The root fills the host's `.tabBody` (`display:flex; height:100%;
     * min-height:0; overflow:hidden`) — the host gives a tab body no padding and
     * no scrollbar, so every scroll area here is declared explicitly.
     */
    const CSS = [
      '.lite-git-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;box-sizing:border-box;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-base,transparent)}',
      // The strip's height is not a taste decision: the shell draws the
      // conversation header's horizontal rule at the bottom of a 38px tab strip
      // (`_tabStrip` is `height:28px; padding:10px 6px 0`, and the shell's own
      // sidebar tabs — files, browser, deliverables — each open with a
      // `height:38px; border-bottom:.5px` header). A tab body therefore starts at
      // y=38 and its first rule has to land at 38+38=76, exactly on the
      // conversation's line. Measured against the live app: a header that is
      // 39px tall (8px+24px+6px padding plus a 1px border) sits one pixel low,
      // which is visible as two rules that do not meet.
      '.lite-git-head{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:6px;height:38px;padding:0 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));min-width:0}',
      '.lite-git-ident{display:flex;align-items:baseline;gap:6px;min-width:0;flex:1 1 auto}',
      '.lite-git-repo{font-weight:600;color:var(--dsw-alias-label-primary,#111827);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.lite-git-branch{flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}',
      '.lite-git-ab{flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px}',
      '.lite-git-tools{flex:none;display:flex;align-items:center;gap:2px}',
      '.lite-git-iconBtn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;flex:none}',
      '.lite-git-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-iconBtn:disabled{opacity:.4;cursor:default}',
      '.lite-git-iconBtn:focus-visible,.lite-git-btn:focus-visible,.lite-git-input:focus-visible,.lite-git-tick:focus-visible,.lite-git-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}',
      '.lite-git-iconBtn svg{width:15px;height:15px;display:block}',
      '.lite-git-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary,#111827);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '.lite-git-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.lite-git-btn:disabled{opacity:.45;cursor:default}',
      '.lite-git-btn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-static-neutral-bluish-00,#fff);font-weight:500}',
      '.lite-git-btn-primary:hover:not(:disabled){filter:brightness(1.08)}',
      '.lite-git-btn-danger{border-color:var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-state-error-primary,#dc2626)}',
      '.lite-git-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,38,38,.12))}',
      '.lite-git-banner{flex:none;display:flex;align-items:flex-start;gap:6px;margin:6px 10px 0;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);font-size:11.5px;word-break:break-word}',
      '.lite-git-banner-error{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,38,38,.1));color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lite-git-banner-warn{background:var(--dsw-alias-interactive-bg-hover,rgba(180,120,20,.12));color:var(--dsw-alias-state-warn-primary,#92400e)}',
      '.lite-git-banner-ok{background:var(--dsw-alias-interactive-bg-hover,rgba(22,163,74,.12));color:var(--dsw-alias-state-success-primary,#15803d)}',
      '.lite-git-banner svg{width:14px;height:14px;flex:none;margin-top:1px;display:block}',
      '.lite-git-sub{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px 4px;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px;min-width:0}',
      '.lite-git-subTitle{flex:none;font-weight:500;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.lite-git-subStats{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.lite-git-list{flex:1 1 auto;min-height:40px;overflow:auto;padding:2px 6px 6px}',
      '.lite-git-row{display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:var(--dsw-radius-sm,6px);cursor:default;min-width:0}',
      '.lite-git-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',
      '.lite-git-tick{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.45));border-radius:3px;background:transparent;color:var(--dsw-static-neutral-bluish-00,#fff);cursor:pointer}',
      '.lite-git-tick-on{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-tick-partial{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-tick svg{width:11px;height:11px;display:block}',
      '.lite-git-tick-partial span{display:block;width:7px;height:1.5px;background:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      // The header tick lines up with the row ticks below it: the list's own
      // padding (6px) plus the row's (4px) is the sub row's 10px, so no offset is
      // needed — but it does need a slightly larger hit area, because it is a
      // small target that a user aims at once and expects to work.
      '.lite-git-tick-header{width:16px;height:16px;cursor:pointer}',
      '.lite-git-tick-header:disabled{cursor:default;opacity:.45}',
      '.lite-git-contextBtn{width:auto;height:24px;padding:0 10px;font-size:12px;font-weight:500;border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-static-neutral-bluish-00,#fff)}',
      '.lite-git-contextBtn:hover:not(:disabled){background:var(--dsw-alias-state-business-primary,#4d6bfe);filter:brightness(1.08)}',
      '.lite-git-lastFetch{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap}',
      '.lite-git-status{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}',
      '.lite-git-status svg{display:block}',
      '.lite-git-status-added{color:var(--dsw-alias-state-success-primary,#15803d)}',
      '.lite-git-status-modified{color:var(--dsw-alias-state-warn-primary,#b45309)}',
      '.lite-git-status-deleted{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lite-git-status-renamed{color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-status-conflicted{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lite-git-path{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;gap:0;overflow:hidden}',
      // The directory is laid out right-to-left *only* so that, when it has to
      // truncate, the ellipsis lands on the left: `…/docs/guide.md` reads better
      // than `docs/deeply/nes…/guide.md`, and it is what GitHub Desktop does.
      //
      // Two details here are load-bearing and were both got wrong once:
      //
      //   * no `text-align`. In a right-to-left run, `left` is the *end* of the
      //     line, so `text-align:left` pushes the text to the right — which is
      //     exactly the "why is the file name right-aligned" report. The default
      //     (`start`) resolves to the right edge of an rtl box, which is the
      //     intent.
      //   * `flex:0 1 auto`, not `1 1 auto`. A grow factor of 1 lets the directory
      //     claim whatever space the row has left, which shoves the file name to
      //     the far right even when nothing is truncated. Neither should grow; the
      //     directory yields first because it is the part allowed to lose its
      //     beginning.
      '.lite-git-dir{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      // The box above is rtl so the *ellipsis* lands on the left; the text inside
      // it must not be, or the dot at the front of a directory moves to the far
      // end: `.test/abc` is laid out right-to-left as `test/abc.`, which reads as
      // a different directory and, worse, is the widest thing in the row — so a
      // dotted directory is the one that overflows, pushing the name out of view
      // and leaving the row looking like the wrong file.
      //
      // `isolate` rather than a `direction` override: it makes the directory its
      // own run, laid out left-to-right, while leaving the surrounding order (and
      // so the box's own trailing edge) alone.
      '.lite-git-dirText{unicode-bidi:isolate;direction:ltr}',
      // `direction` is inherited, so the rtl above would otherwise reach the
      // separator (moving the slash to the wrong end) and the file name (right-
      // aligning it). Both are spelled back to ltr explicitly.
      '.lite-git-sep{flex:none;direction:ltr;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.lite-git-name{flex:0 1 auto;min-width:0;direction:ltr;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lite-git-stats{flex:none;display:flex;gap:3px;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.lite-git-plus{color:var(--dsw-alias-state-success-primary,#15803d)}',
      '.lite-git-minus{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lite-git-rowBtn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;opacity:0}',
      '.lite-git-row:hover .lite-git-rowBtn,.lite-git-rowBtn:focus-visible{opacity:1}',
      '.lite-git-rowBtn:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,38,38,.14));color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lite-git-rowBtn svg{width:14px;height:14px;display:block}',
      '.lite-git-empty{padding:14px 12px;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11.5px;text-align:center}',
      '.lite-git-commit{flex:none;display:flex;flex-direction:column;gap:5px;padding:8px 10px 10px;border-top:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.18))}',
      '.lite-git-summaryRow{display:flex;align-items:center;gap:4px}',
      '.lite-git-input{box-sizing:border-box;flex:1 1 auto;min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;font-size:12px}',
      '.lite-git-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b7280)}',
      'textarea.lite-git-input{height:auto;min-height:56px;padding:6px 8px;resize:vertical;line-height:1.5}',
      '.lite-git-disclose{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer}',
      '.lite-git-disclose:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-disclose svg{width:13px;height:13px;display:block;transition:transform 120ms var(--ds-ease-in-out,ease)}',
      '.lite-git-disclose-open svg{transform:rotate(90deg)}',
      '.lite-git-scriptToggle{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);font:inherit;font-size:11px;cursor:pointer}',
      '.lite-git-scriptToggle:hover{color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-scriptToggle svg{width:12px;height:12px;display:block;flex:none}',
      '.lite-git-scriptBox{display:flex;flex-direction:column;gap:5px}',
      '.lite-git-scriptRow{display:flex;align-items:center;gap:5px;min-width:0}',
      '.lite-git-scriptHint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      'textarea.lite-git-scriptEditor{min-height:52px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45}',
      '.lite-git-actions{display:flex;gap:6px}',
      '.lite-git-actions .lite-git-btn{flex:1 1 0;min-width:0}',
      '.lite-git-overlay{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:12px;background:var(--dsw-alias-bg-mask-1,rgba(15,23,42,.45))}',
      '.lite-git-dialog{box-sizing:border-box;width:100%;max-width:360px;max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 12px 32px rgba(0,0,0,.28)}',
      '.lite-git-dialogTitle{font-size:13px;font-weight:600;word-break:break-word}',
      '.lite-git-dialogList{margin:0;padding:0 0 0 16px;max-height:140px;overflow:auto;font-size:11.5px;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.lite-git-dialogList li{word-break:break-all}',
      '.lite-git-dialogMore{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.lite-git-checkRow{display:flex;align-items:flex-start;gap:7px;cursor:pointer;user-select:none}',
      '.lite-git-checkRow input{margin:2px 0 0;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-checkText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.lite-git-checkHint{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.lite-git-dialogActions{display:flex;justify-content:flex-end;gap:6px}',
      // The open-with menu. An absolutely positioned popup inside the panel, not
      // a portal: there is no measurement here, so there is nothing the host's
      // own popover service would buy — and a portal would have to be dismissed
      // from an event listener the panel otherwise never needs.
      '.lite-git-openWrap{position:relative;display:flex;align-items:center}',
      '.lite-git-caretBtn{width:15px;padding:0;border-radius:0 var(--dsw-radius-sm,6px) var(--dsw-radius-sm,6px) 0}',
      '.lite-git-caretBtn svg{width:11px;height:11px}',
      // The scrim is what makes "click anywhere else to dismiss" work without a
      // document listener. It is transparent on purpose: dimming the panel would
      // read as a modal, and a menu is not one.
      '.lite-git-menuScrim{position:absolute;inset:0;z-index:9;background:transparent}',
      '.lite-git-menu{position:absolute;top:33px;right:6px;z-index:10;display:flex;flex-direction:column;gap:1px;min-width:150px;max-width:240px;padding:4px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 8px 24px rgba(15,23,42,.18)}',
      '.lite-git-menuItem{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden}',
      '.lite-git-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.lite-git-menuItem svg{width:12px;height:12px;flex:none;display:block;color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-menuLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.lite-git-picker{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:12px 10px}',
      '.lite-git-pickerTitle{font-size:12.5px;font-weight:600}',
      '.lite-git-pickerHint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.lite-git-candidate{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;font-size:11.5px;text-align:left;cursor:pointer}',
      '.lite-git-candidate:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.lite-git-candidatePath{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}',
      '.lite-git-tabTitle{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%}',
      '.lite-git-tabTitle svg{width:14px;height:14px;flex:none;display:block}',
      '.lite-git-tabTitleText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // The conversation header's toolbar icon. It is not inside the right column,
      // so it copies the shell's own header control rather than the panel's:
      // 28px tall, no border, the secondary label colour, and a hover that is a
      // background — the same shape the ⋯ button beside it has. Sizes in `em`
      // where the host uses its own, so the icon tracks the header's font size.
      '.lite-git-headerIcon{position:relative;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;line-height:1}',
      '.lite-git-headerIcon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-headerIcon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}',
      '.lite-git-headerIcon:disabled{cursor:default;opacity:.55}',
      '.lite-git-headerIcon svg{width:15px;height:15px;display:block}',
      // A count, when there is one. Not a red notification dot: a change waiting
      // to be committed is not an alarm, and the number is the useful part.
      '.lite-git-headerIcon-active{color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-headerBadge{position:absolute;top:-1px;right:-1px;min-width:13px;height:13px;padding:0 3px;border-radius:999px;box-sizing:border-box;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-static-neutral-bluish-00,#fff);font-size:9px;line-height:13px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}',
      '.lite-git-diff{flex:1 1 auto;min-height:0;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;padding:0 0 12px}',
      '.lite-git-diffRow{display:flex;min-width:0}',
      '.lite-git-gutter{flex:none;display:flex;width:66px;color:var(--dsw-alias-label-tertiary,#6b7280);text-align:right;user-select:none}',
      '.lite-git-gutter span{flex:1 1 0;padding:0 5px;min-width:0}',
      '.lite-git-code{flex:1 1 auto;min-width:0;padding:0 8px 0 6px;white-space:pre-wrap;word-break:break-all}',
      // The rows are coloured rather than prefixed. A diff's `+`/`-` is the
      // format's way of saying "added"/"removed", and printing it inside the code
      // column makes every line look like it is part of the source. The gutter
      // carries a one-character sign instead, in its own column, so a `+` in the
      // file itself is still just a `+` in the file.
      // The sign column, and the two row colours. The colours are the shell's own
      // diff tokens, not a reused hover grey: `--dsw-alias-*` values are what the
      // theme sets, so the `rgba` fallbacks only matter where the token is absent.
      // A hover token as the fallback would have looked plausible and been wrong
      // in every real theme — the row would be grey instead of green — which is
      // exactly what a screenshot caught.
      '.lite-git-sign{flex:none;width:12px;padding:0 0 0 4px;text-align:center;user-select:none;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.lite-git-r-file{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#111827);font-weight:600}',
      '.lite-git-r-hunk{background:var(--dsw-alias-code-diff-hunk-bg,rgba(77,107,254,.08));color:var(--dsw-alias-state-business-primary,#1d4ed8)}',
      '.lite-git-r-meta{color:var(--dsw-alias-label-tertiary,#6b7280)}',
      // The shell's own diff colours, used as they are. It ships two pairs and the
      // difference matters: `code-diff-*` is the translucent one meant for a line
      // of code, while `file-diff-*-bg` is an opaque grey-leaning green meant for
      // a file row in a list. Using the second one here is what made the panel
      // look muddy — that was a mistake, not a colour choice.
      '.lite-git-r-add{background:var(--dsw-alias-code-diff-added,rgba(46,160,67,.16));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-r-del{background:var(--dsw-alias-code-diff-deleted,rgba(248,81,73,.16));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-r-add .lite-git-sign{color:var(--dsw-alias-file-diff-added-marker,#01a241)}',
      '.lite-git-r-del .lite-git-sign{color:var(--dsw-alias-file-diff-deleted-marker,#ba2723)}',
      // One background for the whole row. The gutter used to carry a tint of its
      // own, which meant the numbers sat on a different colour from the code next
      // to them — two shades for one line, and the seam is exactly what the eye
      // lands on. The row's own colour covers the gutter too now.
      '.lite-git-r-add .lite-git-gutter,.lite-git-r-del .lite-git-gutter{background:transparent}',
      // The characters that differ: the same colour as the sign, one step denser
      // than the row so it reads on top of it — not a solid block. Solid marker
      // colour with white text turned a one-character diff into a badge, which is
      // louder than the change it is pointing at.
      '.lite-git-codeChanged{border-radius:2px;background:color-mix(in srgb, var(--dsw-alias-file-diff-added-marker,#01a241) 30%, transparent)}',
      '.lite-git-r-del .lite-git-codeChanged{background:color-mix(in srgb, var(--dsw-alias-file-diff-deleted-marker,#ba2723) 30%, transparent)}',
      // The strip that stands in for the lines a diff left out. It is a row of
      // the diff, not a band across it: the two chevrons live in the gutter's
      // column, where the line numbers are, and the count sits where the code
      // does. Pressing one pulls 20 lines in from that edge.
      //
      // The tint is the hunk's own colour, at the strength the doubled-up
      // borders used to fake — a row that sat on white read as a rendering gap
      // rather than as a control.
      '.lite-git-gapRow{background:var(--dsw-alias-code-diff-hunk-bg,rgba(77,107,254,.08))}',
      '.lite-git-gapButtons{flex:none;display:flex;align-items:center;gap:2px;width:66px;padding:0 2px;box-sizing:border-box}',
      // A bare chevron that reacts on hover by *changing colour only*. No
      // background, no border: the row underneath is already the affordance, and
      // a filled or outlined button at this size is heavier than the code it sits
      // beside.
      '.lite-git-gapBtn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:calc(50% - 1px);height:18px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer}',
      '.lite-git-gapBtn:hover:not(:disabled){color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-gapBtn:disabled{opacity:.35;cursor:default}',
      '.lite-git-gapBtn svg{width:13px;height:13px;display:block;stroke-width:1.7}',
      '.lite-git-gapText{color:var(--dsw-alias-state-business-primary,#1d4ed8);font-size:10.5px;user-select:none;align-self:center}',
      // The header's whitespace toggle, as an icon. Off it is the usual quiet
      // icon button; on it goes business-blue, which is what "this filter is
      // active" looks like everywhere else in the shell.
      '.lite-git-wsBtn-on{color:var(--dsw-alias-state-business-primary,#4d6bfe);background:var(--dsw-alias-interactive-bg-hover,rgba(77,107,254,.12))}',
      '.lite-git-wsBtn-on:hover{color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-r-note{color:var(--dsw-alias-label-tertiary,#6b7280);font-style:italic}',
      '.lite-git-r-ctx{color:var(--dsw-alias-label-secondary,#374151)}',
      // The file header card. It replaces the six mechanical lines git prints per
      // file (`diff --git`, `index`, `---`, `+++`, the mode line, the rename pair)
      // with the three facts a reader wants: which file, what happened to it, and
      // how many lines moved.
      '.lite-git-fileHead{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px 5px 6px;margin:6px 0 0;border-top:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.lite-git-fileHead:first-child{margin-top:0;border-top:0}',
      '.lite-git-fileIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}',
      '.lite-git-fileIcon svg{width:13px;height:13px;display:block}',
      '.lite-git-filePath{flex:0 1 auto;min-width:0;display:flex;align-items:baseline;gap:0;overflow:hidden;font-weight:600}',
      '.lite-git-fileDir{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;color:var(--dsw-alias-label-tertiary,#6b7280);font-weight:400}',
      '.lite-git-fileDirText{unicode-bidi:isolate;direction:ltr}',
      '.lite-git-fileName{flex:0 1 auto;min-width:0;direction:ltr;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lite-git-fileFrom{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;color:var(--dsw-alias-label-tertiary,#6b7280);text-decoration:line-through}',
      '.lite-git-fileFromText{unicode-bidi:isolate;direction:ltr}',
      '.lite-git-fileStats{flex:none;display:flex;gap:4px;font-weight:400}',
      '.lite-git-rawToggle{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;margin-left:auto}',
      '.lite-git-rawToggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#111827)}',
      '.lite-git-rawToggle svg{width:12px;height:12px;display:block;transition:transform 120ms var(--ds-ease-in-out,ease)}',
      '.lite-git-rawToggle-open svg{transform:rotate(90deg)}',
      '.lite-git-raw{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280);padding:0 8px 2px 26px;white-space:pre-wrap;word-break:break-all}',
      '.lite-git-hunkSection{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85;font-style:italic}',
      '.lite-git-noEol{flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);font-style:italic;font-size:10px;padding:0 8px 0 4px;user-select:none}',
      '.lite-git-trashRow{display:flex;align-items:flex-start;gap:6px;width:100%;padding:7px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;min-width:0}',
      '.lite-git-trashRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',
      '.lite-git-trashBody{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.lite-git-trashHead{display:flex;align-items:baseline;gap:6px;min-width:0}',
      '.lite-git-trashWhen{flex:none;color:var(--dsw-alias-label-primary,#111827);font-weight:500}',
      '.lite-git-badge{flex:none;padding:0 5px;border-radius:999px;font-size:10px;line-height:15px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.lite-git-trashMeta{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lite-git-trashFiles{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lite-git-toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;user-select:none;white-space:nowrap}',
      '.lite-git-toggle input{margin:0;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.lite-git-trashWhy{display:block;font-size:10.5px;color:var(--dsw-alias-state-warn-primary,#92400e)}',
      '.lite-git-spacer{flex:1 1 auto}',
      '.lite-git-loading{padding:18px 12px;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11.5px;display:flex;align-items:center;gap:6px}',
      '.lite-git-spin{display:inline-block;width:13px;height:13px;flex:none;animation:lite-git-spin .9s linear infinite}',
      '.lite-git-spin svg{width:13px;height:13px;display:block}',
      '@keyframes lite-git-spin{to{transform:rotate(360deg)}}',
      // The header's activity slot: it occupies the same width whether or not an
      // action is running, so the buttons beside it do not jump sideways when a
      // fetch starts. It sits where the context button is, because that is what
      // the user just pressed.
      '.lite-git-busy{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary,#4b5563);font-size:11px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;animation:lite-git-busyIn 140ms var(--ds-ease-in-out,ease) both}',
      '.lite-git-busy .lite-git-spin{width:12px;height:12px}',
      '.lite-git-busy .lite-git-spin svg{width:12px;height:12px}',
      '.lite-git-busyText{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      // Nothing else in the header may claim a press while an action runs: the
      // panel reads that as a return and would re-read the repository underneath
      // the git child that is still writing to it.
      '@keyframes lite-git-busyIn{from{opacity:0}to{opacity:1}}',
      '.lite-git-tools[data-lite-git-busy="true"] .lite-git-iconBtn:disabled{opacity:.35}',
    ].join('\n')

    /** Inject the stylesheet once, through the usual `data-plugin` marker. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return
      const tag = document.createElement('style')
      tag.setAttribute(STYLE_ATTR, '')
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /* ------------------------------------------------------------------ *
     * 6. RPC
     * ------------------------------------------------------------------ */

    /** An action failure carrying the host's code, so the UI can localize it. */
    function RpcError(code, message) {
      const error = new Error(message)
      error.name = 'RpcError'
      error.code = code
      return error
    }

    /**
     * One host call.
     *
     * The body is read before the status is judged: a failure still arrives as
     * JSON with `{ ok:false, error }`, and a non-2xx status must not be the only
     * signal.
     */
    async function rpc(action, payload, signal) {
      const body = Object.assign({ action }, payload === undefined ? {} : payload)
      let response
      try {
        response = await fetch(RPC_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        if (error !== null && error !== undefined && error.name === 'AbortError') throw error
        throw RpcError('E_TRANSPORT', String((error && error.message) || error))
      }

      let data = null
      try {
        data = await response.json()
      } catch {
        throw RpcError('E_BAD_RESPONSE', `HTTP ${response.status}`)
      }
      if (data === null || typeof data !== 'object') throw RpcError('E_BAD_RESPONSE', `HTTP ${response.status}`)
      if (data.ok !== true) {
        const failure = data.error
        throw RpcError(
          failure !== null && typeof failure?.code === 'string' ? failure.code : 'E_UNKNOWN',
          failure !== null && typeof failure?.message === 'string' ? failure.message : `HTTP ${response.status}`,
        )
      }
      return data
    }

    /* ------------------------------------------------------------------ *
     * 7. Shared pieces
     * ------------------------------------------------------------------ */

    /** A `<button>` with the panel's icon-button chrome. */
    function IconButton({ label, onClick, disabled, className, children, attrs }) {
      return h(
        'button',
        {
          type: 'button',
          className: `lite-git-iconBtn${className === undefined ? '' : ` ${className}`}`,
          title: label,
          'aria-label': label,
          disabled: disabled === true,
          onClick,
          ...(attrs ?? {}),
        },
        children,
      )
    }

    /** The loading indicator: the host's arc plus a plain rotation. */
    function LoadingGlyph() {
      // `IconLoadingOutlineRegular` — the arc the host itself spins.
      const Arc = artwork(
        '0 0 16 16',
        [
          'M12.596 12.596C11.687 13.5049 10.5288 14.1239 9.26798 14.3747C8.00716 14.6255 6.70028 14.4968 5.51261 14.0048C4.32494 13.5129 3.30981 12.6798 2.59557 11.611C1.88134 10.5421 1.50008 9.2855 1.5 7.99998C1.50008 6.71446 1.88134 5.45783 2.59557 4.38898C3.30981 3.32013 4.32494 2.48707 5.51261 1.99513C6.70028 1.50319 8.00716 1.37447 9.26798 1.62524C10.5288 1.87602 11.687 2.49502 12.596 3.40398',
        ],
        [],
      )
      return h('span', { className: 'lite-git-spin', 'aria-hidden': 'true' }, h(Arc, {}))
    }

    function Spinner({ label }) {
      return h('div', { className: 'lite-git-loading' }, [h(LoadingGlyph, { key: 's' }), h('span', { key: 't' }, label)])
    }

    /** A one-line notice above the list. */
    function Banner({ tone, text, onClose, closeLabel }) {
      const Glyph = tone === 'error' ? WarningGlyph : tone === 'warn' ? WarningGlyph : CheckGlyph
      return h('div', { className: `lite-git-banner lite-git-banner-${tone}`, role: 'status' }, [
        h(Glyph, { key: 'g' }),
        h('span', { key: 't', style: { flex: '1 1 auto', minWidth: 0 } }, text),
        onClose === undefined
          ? null
          : h(
              'button',
              {
                key: 'x',
                type: 'button',
                className: 'lite-git-iconBtn',
                style: { width: 18, height: 18 },
                title: closeLabel,
                'aria-label': closeLabel,
                onClick: onClose,
              },
              h(CloseGlyph, { size: 12 }),
            ),
      ])
    }

    /** The username-and-repo tail of a path, for a narrow column. */
    function shortPath(path) {
      const parts = String(path ?? '').split(/[\\/]/).filter((part) => part !== '')
      return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
    }

    /* ------------------------------------------------------------------ *
     * 8. The panel
     * ------------------------------------------------------------------ */

    /**
     * One changed file, laid out the way GitHub Desktop lays one out.
     *
     * `ticked` is the only thing the box reflects. It is a two-state box now: the
     * indeterminate state existed because a tick used to *be* the index, so a file
     * whose index and worktree differed had to be drawn as "neither". A tick is a
     * choice about the next commit, so there is no third state to draw and a file
     * nobody ticked can never look half-ticked again.
     */
    function ChangeRow({ file, t, ticked, onToggle, onDiscard, onOpen }) {
      const kind = statusKind(file)
      const Mark = statusGlyph(kind)
      const parts = splitPath(file.path)
      // Desktop renders the directory *before* the name and lets the directory be
      // the part that truncates, so the name survives. The separator is its own
      // node because `direction:rtl` (how the directory gets a leading ellipsis)
      // would move a trailing slash to the other end of the text.
      const dir = parts.dir.endsWith('/') ? parts.dir.slice(0, -1) : parts.dir
      const display = file.origPath === undefined ? file.path : `${file.origPath} → ${file.path}`
      const on = ticked === true

      return h(
        'div',
        {
          className: 'lite-git-row',
          'data-lite-git-row': file.path,
          'data-lite-git-staged': on ? 'true' : 'false',
          'data-lite-git-kind': kind,
          title: display,
          // Only the tick changes a file's state. The row is still the thing a
          // double-click opens a diff from, but a single click anywhere else is
          // *not* a press on the tick: the path, the stats and the empty space
          // beside them are where the pointer lands while reading, and having
          // that quietly commit a file to the next commit is the wrong default.
          // Shift-ranges follow the same rule — they are a range *of ticks*.
          onDoubleClick: () => onOpen(file.path),
        },
        [
          h(
            'button',
            {
              key: 'tick',
              type: 'button',
              className: `lite-git-tick${on ? ' lite-git-tick-on' : ''}`,
              'data-lite-git-tick': file.path,
              'aria-checked': on ? 'true' : 'false',
              role: 'checkbox',
              'aria-label': file.path,
              onClick: (event) => {
                event.stopPropagation()
                onToggle(file, event.shiftKey === true)
              },
            },
            on ? h(CheckGlyph, { size: 11 }) : null,
          ),
          h('span', { key: 'path', className: 'lite-git-path' }, [
            dir === ''
              ? null
              : h(
                  'span',
                  { key: 'dir', className: 'lite-git-dir' },
                  // The text sits one level deeper than the rtl box, so the box
                  // can place the ellipsis at the left while the directory itself
                  // is still read left to right. Both halves are needed: dropping
                  // the wrapper turns `.test/abc` into `test/abc.`, and dropping
                  // the rtl box puts the ellipsis on the right.
                  h('span', { key: 't', className: 'lite-git-dirText' }, dir),
                ),
            dir === '' ? null : h('span', { key: 'sep', className: 'lite-git-sep' }, '/'),
            h('span', { key: 'name', className: 'lite-git-name' }, parts.name),
          ]),
          h('span', { key: 'stats', className: 'lite-git-stats' }, [
            (file.added ?? 0) > 0 ? h('span', { key: 'p', className: 'lite-git-plus' }, `+${file.added}`) : null,
            (file.deleted ?? 0) > 0 ? h('span', { key: 'm', className: 'lite-git-minus' }, `−${file.deleted}`) : null,
          ]),
          h(
            'button',
            {
              key: 'discard',
              type: 'button',
              className: 'lite-git-rowBtn',
              'data-lite-git-discard': file.path,
              title: t('action.discard'),
              'aria-label': t('action.discard'),
              onClick: (event) => {
                event.stopPropagation()
                onDiscard(file.path)
              },
            },
            h(TrashGlyph, { size: 14 }),
          ),
          // Last in the row, as in Desktop: the checkbox and the path start the
          // row, the mark ends it.
          h(
            'span',
            {
              key: 'mark',
              className: `lite-git-status lite-git-status-${kind}`,
              'data-lite-git-status': kind,
              title: t(`status.${kind}`),
              'aria-label': t(`status.${kind}`),
            },
            h(Mark, { size: 13 }),
          ),
        ],
      )
    }

    /** The discard confirmation, drawn inside the panel rather than portalled. */
    function DiscardDialog({ pending, t, onCancel, onHardDeleteChange, onConfirm }) {
      if (pending === null) return null
      const files = pending.files
      const shown = files.slice(0, 8)
      const title =
        pending.paths === null
          ? t('discard.all', { files: files.length })
          : t('discard.one', { path: pending.paths[0] })

      return h('div', { className: 'lite-git-overlay', 'data-lite-git-dialog': 'discard' }, [
        h('div', { className: 'lite-git-dialog', role: 'dialog', 'aria-modal': 'true' }, [
          h('div', { key: 'title', className: 'lite-git-dialogTitle' }, title),
          h(
            'ul',
            { key: 'list', className: 'lite-git-dialogList' },
            shown.map((file) => h('li', { key: file }, file)),
          ),
          files.length > shown.length
            ? h('div', { key: 'more', className: 'lite-git-dialogMore' }, t('discard.more', { n: files.length - shown.length }))
            : null,
          h('label', { key: 'hard', className: 'lite-git-checkRow' }, [
            h('input', {
              type: 'checkbox',
              checked: pending.hardDelete,
              'data-lite-git-hard': '',
              onChange: (event) => onHardDeleteChange(event.target.checked === true),
            }),
            h('span', { className: 'lite-git-checkText' }, [
              h('span', { key: 'l' }, t('discard.hard')),
              h('span', { key: 'h', className: 'lite-git-checkHint' }, pending.hardDelete ? t('discard.hardHint') : t('discard.keep')),
            ]),
          ]),
          h('div', { key: 'actions', className: 'lite-git-dialogActions' }, [
            h(
              'button',
              { key: 'cancel', type: 'button', className: 'lite-git-btn', onClick: onCancel },
              t('action.cancel'),
            ),
            h(
              'button',
              {
                key: 'go',
                type: 'button',
                className: 'lite-git-btn lite-git-btn-danger',
                'data-lite-git-confirm': '',
                onClick: onConfirm,
              },
              t('action.confirm'),
            ),
          ]),
        ]),
      ])
    }

    /** The repository picker for a workspace that is not a repository. */
    function RepositoryPicker({ candidates, truncated, scanning, pathInput, t, onPick, onPath, onPathChange, onRescan, onUnbind, bound, canUnbind }) {
      const unbindable = bound !== null && canUnbind !== false
      return h('div', { className: 'lite-git-picker', 'data-lite-git-picker': '' }, [
        h('div', { key: 'title', className: 'lite-git-pickerTitle' }, t('bind.title')),
        h('div', { key: 'hint', className: 'lite-git-pickerHint' }, t('bind.hint')),
        bound === null
          ? null
          : h('div', { key: 'bound', className: 'lite-git-pickerHint' }, [
              t('bind.current', { path: bound }),
              ' ',
              h(
                'button',
                {
                  key: 'unbind',
                  type: 'button',
                  className: 'lite-git-btn',
                  style: { marginLeft: 6 },
                  'data-lite-git-unbind': unbindable ? 'on' : 'here',
                  disabled: !unbindable,
                  // Same rule as the header's button, and the same sentence: this
                  // workspace being the repository itself is the one case where
                  // clearing the binding cannot change anything.
                  title: unbindable ? '' : t('action.unbindHere'),
                  onClick: onUnbind,
                },
                t('action.unbind'),
              ),
            ]),
        scanning ? h(Spinner, { key: 'scan', label: t('bind.scanning') }) : null,
        !scanning && candidates.length === 0
          ? h('div', { key: 'none', className: 'lite-git-pickerHint' }, t('bind.noCandidates'))
          : null,
        ...candidates.map((candidate) =>
          h(
            'button',
            {
              key: candidate.path,
              type: 'button',
              className: 'lite-git-candidate',
              'data-lite-git-candidate': candidate.path,
              onClick: () => onPick(candidate.path),
            },
            [
              h(GitGlyph, { key: 'g', size: 14 }),
              h('span', { key: 'p', className: 'lite-git-candidatePath', title: candidate.path }, candidate.path),
            ],
          ),
        ),
        truncated ? h('div', { key: 'trunc', className: 'lite-git-pickerHint' }, t('bind.truncated')) : null,
        h('div', { key: 'manual', className: 'lite-git-summaryRow' }, [
          h('input', {
            key: 'input',
            className: 'lite-git-input',
            placeholder: t('bind.pathPlaceholder'),
            value: pathInput,
            'data-lite-git-pathinput': '',
            onChange: (event) => onPathChange(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onPath()
            },
          }),
          h('button', { key: 'go', type: 'button', className: 'lite-git-btn', onClick: onPath }, t('bind.bindPath')),
        ]),
        h(
          'button',
          { key: 'rescan', type: 'button', className: 'lite-git-btn', onClick: onRescan, disabled: scanning },
          t('bind.rescan'),
        ),
      ])
    }

    /**
     * The Git panel body.
     *
     * Ticks are not local state: a file's tick *is* whether all of its change is
     * in the repository index, so ticking calls the host and adopts the status
     * that comes back. That is what keeps this panel and `git status` in a
     * terminal from ever disagreeing.
     */
    function GitBody(props) {
      const t = props.t ?? fallbackTranslate()
      const ctx = props.ctx
      // `useTabInfo` is a hook the host binds into this seat's props (the shell
      // declares `inject: { hooks: { tabInfo } }` on the slot itself), so it has
      // to be called unconditionally at the top of the body.
      const tab = props.useTabInfo().tab
      const sessionId = props.sessionId ?? tab.sessionId

      const [state, setState] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(null)
      // The user's unticked paths — see the long note where `setTicked` is
      // declared. It lives here, beside the other view state, because the render
      // reads it and nothing outside the client mutates it.
      const [excluded, setExcluded] = useState(new Set())
      const [summary, setSummary] = useState('')
      const [description, setDescription] = useState('')
      const [descriptionOpen, setDescriptionOpen] = useState(false)
      const [pending, setPending] = useState(null)
      const [pathInput, setPathInput] = useState('')
      const [scanning, setScanning] = useState(false)
      // The script editor. `scriptDraft` is what the textarea holds, which is not
      // the same as what is saved until the user blurs it or presses Save: the
      // half-typed state must not be what a run uses.
      const [scriptOpen, setScriptOpen] = useState(false)
      const [scriptDraft, setScriptDraft] = useState('')
      const [scriptSaved, setScriptSaved] = useState('')

      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])

      // The live view of the panel's own state, for the code that runs from timers
      // and event listeners: those hold a closure from one particular render, and
      // a closure from one particular render is a closure about the past.
      //
      // Declared here, above `load`, because `load` publishes into it as soon as a
      // read lands — the continuation that follows a read runs before React
      // re-renders, and until the ref is updated it would be looking at the state
      // from before the read.
      const latest = useRef({ state: null, busy: null, visible: true, excluded: new Set() })

      /**
       * Fetch the whole panel state. Never throws.
       *
       * Answers with the payload it adopted, or `false` when the read failed. The
       * payload is what makes "read the list, then let the script fill the Summary"
       * correct on the very first open: the caller is a promise continuation that
       * runs before React has re-rendered, so every value it could get from the
       * render's own closure — the script, `hasScript` — is the one from *before*
       * the state arrived. The freshly read status has neither problem.
       */
      const load = useCallback(
        async (options = {}) => {
          if (options.quiet !== true) setPhase((current) => (current === 'ready' ? current : 'loading'))
          try {
            const data = await rpc(ACTIONS.STATUS, { sessionId }, tab.signal)
            if (!alive.current) return false
            setState(data)
            // Published immediately as well as through the render: see above.
            latest.current = { ...latest.current, state: data }
            setError(null)
            setPhase('ready')
            return data
          } catch (failure) {
            if (!alive.current || failure?.name === 'AbortError') return false
            setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
            setPhase('error')
            return false
          }
        },
        [sessionId, tab.signal],
      )

      // Fetch unattended, in the background, while the panel is being looked at.
      //
      // GitHub Desktop's shape (`BackgroundFetcher` in app-store), which this
      // copies: the interval is long (an hour by default, with a five-minute
      // floor when the server suggests one), each tick re-asks whether it should
      // run, the next tick is scheduled from the *completion* of the last one
      // rather than on a fixed period, and a failure is logged and forgotten.
      //
      // Three gates, each with a reason:
      //
      //   * the tab must be visible — a hidden panel has no business touching the
      //     network, and the host may have several sessions;
      //   * the repository must have a remote — otherwise `fetch` is a guaranteed
      //     E_NO_REMOTE, and a timer that only ever fails is noise;
      //   * nothing else may be in flight — a user mid-commit must not have an
      //     extra git child appear under them.
      //
      // The "has it been long enough" question is answered by the repository
      // itself: `lastFetchAt` is the mtime of `.git/FETCH_HEAD`, so a fetch run
      // in a terminal counts, and a repository the user fetched a minute ago is
      // left alone however long the panel stays open.
      //
      // The conditions are read through a ref rather than listed as dependencies
      // on purpose: a dependency on `state` would restart the clock on every
      // refresh, and a panel the user keeps interacting with would then never
      // fetch at all.
      latest.current = { ...latest.current, state, busy, visible: tab.visible !== false, excluded }

      const autoFetchMs = typeof state?.autoFetchMs === 'number' && state.autoFetchMs > 0 ? state.autoFetchMs : 0
      useEffect(() => {
        if (autoFetchMs === 0) return undefined
        if (tab.visible === false) return undefined

        const sinceLastFetch = () => {
          const at = latest.current.state?.lastFetchAt
          const when = Date.parse(typeof at === 'string' ? at : '')
          if (!Number.isFinite(when)) return Number.POSITIVE_INFINITY
          return Date.now() - when
        }

        // Reschedule from completion, not on a fixed period, so a slow fetch
        // cannot stack up behind itself. The skew keeps two panels that happened
        // to open together from fetching in lockstep forever.
        let timer = null
        let stopped = false
        const schedule = () => {
          if (stopped) return
          const wait = Math.max(0, autoFetchMs - sinceLastFetch()) + Math.ceil(Math.random() * 30000)
          timer = setTimeout(tick, wait)
        }
        const tick = () => {
          const current = latest.current
          if (current.busy !== null) return schedule()
          if (!Array.isArray(current.state?.remotes) || current.state.remotes.length === 0) return schedule()
          if (sinceLastFetch() < autoFetchMs) return schedule()

          void rpc(ACTIONS.FETCH, { sessionId }, tab.signal)
            .then(() => {
              if (alive.current) void load({ quiet: true })
            })
            .catch(() => {
              // Deliberately swallowed: see the note above.
            })
            .finally(schedule)
        }

        schedule()
        return () => {
          stopped = true
          if (timer !== null) clearTimeout(timer)
        }
      }, [autoFetchMs, tab.visible, tab.signal, sessionId, load])

      /** Say something briefly. */
      const flash = useCallback((tone, text) => {
        setNotice({ tone, text, at: Date.now() })
      }, [])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => {
          if (alive.current) setNotice(null)
        }, 6000)
        return () => clearTimeout(timer)
      }, [notice])

      /**
       * Re-read the repository on the user's behalf: the header's refresh button
       * and the column's refresh command.
       *
       * It says so on success. A refresh that worked looks exactly like a refresh
       * that found nothing new, so without a word the button is indistinguishable
       * from one that did nothing at all.
       */
      const refresh = useCallback(async () => {
        if (await load({ quiet: true })) flash('ok', t('toast.refreshed'))
      }, [load, flash, t])

      // The column's refresh shortcut, when it has one.
      useEffect(
        () => (typeof tab.actions?.bindCommands === 'function' ? tab.actions.bindCommands({ refresh: () => void refresh() }) : undefined),
        [tab.actions, refresh],
      )

      /** Run one mutating action, adopting the status it returns. */
      const run = useCallback(
        async (kind, action, payload, onDone, options) => {
          // A tick does not take the panel busy. Staging is a small git command
          // (~70 ms measured) and the round trip that follows it is the rest, so
          // marking the whole panel busy would grey out the list and the commit
          // buttons for a fifth of a second on every single click — which is
          // exactly the "why is ticking so slow" feeling this avoids. The row is
          // already showing its new state optimistically; the response only
          // corrects it.
          const silent = options?.silent === true
          if (!silent) setBusy(kind)
          try {
            const data = await rpc(action, { sessionId, ...(payload ?? {}) }, tab.signal)
            if (!alive.current) return null
            setError(null)
            // Most actions answer with a fresh status; binding answers with only
            // the new repository, so anything that is not a status is followed by
            // a re-read rather than being mistaken for one.
            if (Array.isArray(data.files) && data.branch !== undefined) setState(data)
            else await load({ quiet: true })
            if (onDone !== undefined) onDone(data)
            return data
          } catch (failure) {
            if (!alive.current) return null
            if (failure?.name === 'AbortError') return null
            setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
            // Even a failed action can have changed the repository (a commit that
            // did land before its push was rejected), so re-read.
            void load({ quiet: true })
            return null
          } finally {
            if (alive.current && !silent) setBusy(null)
          }
        },
        [sessionId, load, tab.signal],
      )

      /**
       * Paths the user has taken the tick off, for this repository.
       *
       * A tick is a choice the panel owns, so all that has to be remembered is the
       * exception: everything is ticked unless it is named here. Two consequences
       * follow, and both are what GitHub Desktop does:
       *
       *   - a change that appears after the panel opened is ticked, because "not
       *     excluded" is the default — no rule has to notice it;
       *   - a file the user unticked stays unticked, because a refresh has no say
       *     over this set. Nothing the host reports can add to it or clear it.
       *
       * The set is per repository: it is cleared when the bound repository
       * changes, so switching repositories is not a way to inherit another one's
       * untick. It is deliberately *not* persisted — a reload is a fresh look at
       * the tree, and Desktop starts with everything included too.
       */
      const excludedRepo = useRef(null)

      const setTicked = useCallback((paths, ticked) => {
        setExcluded((current) => {
          const next = new Set(current)
          for (const path of paths) {
            if (ticked) next.delete(path)
            else next.add(path)
          }
          return next
        })
      }, [])

      /**
       * The row a Shift-click measures from.
       *
       * Set by *any* press — a plain one too, because "按住 Shift 从头点到尾" means
       * the first row was pressed normally and the last one with Shift, and the
       * range is measured between the two. It survives letting Shift go: the batch
       * ends, but which row it started from is still the answer to "where does the
       * next range begin", which is the row the user pressed last.
       */
      const anchor = useRef(null)

      /**
       * The batch a held Shift is in.
       *
       * `base` is how the whole list looked when the batch started, `applied` is
       * how this batch has changed it so far. Keeping both is what makes the far
       * end movable: rows that leave the range go back to `base`, rows in it take
       * the inverse of `base`. Nothing is computed from the *current* tick state,
       * so one batch has one answer and dragging its end can never drift.
       */
      const gesture = useRef(null)

      /** Tick state of one path, from the panel's own excluded set. */
      function isTicked(path, excludedSet) {
        return !(excludedSet !== undefined && excludedSet.has(path))
      }

      /** The live excluded set: the ref is updated on every render, so it is current. */
      function liveExcluded() {
        const live = latest.current.excluded
        return live instanceof Set ? live : excluded
      }

      /**
       * The rows a range covers, and the tick each of them should end up with.
       *
       * The range runs from the anchor to the pressed row. The **anchor keeps the
       * state its own click gave it** — it is the reference point, the way a
       * control-click sets the anchor in a file manager and a shift-click extends
       * from it — and every row between it and the pressed row, the pressed row
       * included, is *inverted* against how it looked when the batch started.
       *
       * That is "改变中间所有的状态…改变状态就是反转", and it is what makes the far end
       * movable: press further and rows join the range, press back and they leave
       * it, without anything being flipped twice.
       *
       * A conflicted row is skipped: a tick there is consent to record a resolution
       * nobody made, and the host refuses to commit one anyway.
       *
       * @param {{ path: string, conflicted?: boolean }[]} files the list, in draw order
       * @param {Map<string, boolean>} base path → ticked, as of the start of the batch
       * @param {string} fromPath the anchor
       * @param {string} toPath the row pressed
       * @returns {Map<string, boolean>} path → the tick it should carry now
       */
      function rangePlan(files, base, fromPath, toPath) {
        const plan = new Map()
        const paths = files.map((file) => file.path)
        const from = paths.indexOf(fromPath)
        const to = paths.indexOf(toPath)
        if (from < 0 || to < 0) return plan
        const low = Math.min(from, to)
        const high = Math.max(from, to)
        for (let index = low; index <= high; index += 1) {
          const file = files[index]
          if (file.path === fromPath) continue
          if (file.conflicted === true) continue
          const before = base.has(file.path) ? base.get(file.path) : true
          plan.set(file.path, !before)
        }
        return plan
      }

      /** The list as a path → ticked map, from the panel's excluded set. */
      function snapshotTicks(files, excludedSet) {
        const ticks = new Map()
        for (const row of files) ticks.set(row.path, isTicked(row.path, excludedSet))
        return ticks
      }

      /**
       * Put a plan on screen.
       *
       * Rows the plan covers take their planned tick; rows the *previous* press of
       * the same batch covered but this one does not go back to the state they had
       * before the batch started. That fallback is what makes the far end movable
       * rather than sticky.
       *
       * @param {Map<string, boolean>} plan the paths this press covers
       * @param {Map<string, boolean>} previous what the last press covered
       */
      function applyPlan(plan, previous) {
        const wanted = new Map(plan)
        const base = gesture.current === null ? null : gesture.current.base
        for (const path of previous.keys()) {
          if (wanted.has(path) || base === null) continue
          wanted.set(path, base.has(path) ? base.get(path) : true)
        }
        if (wanted.size === 0) return
        setExcluded((live) => {
          const next = new Set(live)
          for (const [path, ticked] of wanted) {
            if (ticked) next.delete(path)
            else next.add(path)
          }
          return next
        })
      }

      /**
       * One press on a row, with or without Shift.
       *
       * Without Shift it is a plain toggle, and it *also* becomes the anchor: a
       * following Shift-press measures back to it. That is how the reported gesture
       * is actually performed — press the first row, hold Shift, press the last —
       * and it is also why a plain press in the middle of a held batch drops that
       * batch instead of quietly extending it.
       *
       * With Shift, every row from the anchor to this one is inverted against how
       * it looked when the batch started, the anchor itself excepted. Holding Shift
       * keeps that anchor, so pressing further along only moves the far end of one
       * batch; letting Shift go ends it, and the row pressed last becomes the
       * anchor of the next one.
       *
       * @param {{ path: string, conflicted?: boolean }} file the row pressed
       * @param {boolean} shiftKey whether Shift was held
       */
      const toggle = useCallback(
        (file, shiftKey) => {
          const files = Array.isArray(latest.current.state?.files) ? latest.current.state.files : []
          const live = liveExcluded()

          if (shiftKey !== true) {
            gesture.current = null
            anchor.current = file.path
            const on = isTicked(file.path, live)
            setExcluded((current) => {
              const next = new Set(current)
              if (on) next.add(file.path)
              else next.delete(file.path)
              return next
            })
            return
          }

          if (gesture.current === null) {
            const known = typeof anchor.current === 'string' && files.some((row) => row.path === anchor.current)
            if (!known) {
              // The very first Shift-press has nothing to measure back to, so it
              // marks this row and settles it the way a plain press would. The
              // batch's snapshot is the list *after* that, so the next press cannot
              // flip this row back.
              anchor.current = file.path
              const on = isTicked(file.path, live)
              setExcluded((current) => {
                const next = new Set(current)
                if (on) next.add(file.path)
                else next.delete(file.path)
                gesture.current = { base: snapshotTicks(files, next), anchor: file.path, last: file.path, applied: new Map() }
                return next
              })
              return
            }
            gesture.current = { base: snapshotTicks(files, live), anchor: anchor.current, last: anchor.current, applied: new Map() }
          }

          const plan = rangePlan(files, gesture.current.base, gesture.current.anchor, file.path)
          applyPlan(plan, gesture.current.applied)
          gesture.current.applied = plan
          gesture.current.last = file.path
        },
        // The only value read across renders is the excluded set, and it is read
        // from the ref first; `excluded` is the fallback for a render that has not
        // published to the ref yet.
        [excluded],
      )

      /**
       * Letting Shift go ends the batch.
       *
       * The row pressed last becomes the anchor, which is "松开就是新一批": the next
       * batch is measured from where you stopped on, not from where the last one
       * began.
       */
      const endRange = useCallback(() => {
        const live = gesture.current
        gesture.current = null
        if (live !== null && typeof live.last === 'string') anchor.current = live.last
      }, [])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKeyUp = (event) => {
          if (event.key !== 'Shift') return
          endRange()
        }
        // `blur` too: a window that loses focus never delivers the key-up, and a
        // gesture that can only be ended by a key event the browser will not send
        // is a gesture that never ends.
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', endRange)
        return () => {
          window.removeEventListener('keyup', onKeyUp)
          window.removeEventListener('blur', endRange)
        }
      }, [endRange])

      // A path that is gone is not a choice any more, and a different repository
      // is a different set of choices. Without this the set would only ever grow,
      // and a file that is committed or reverted and then reappears would come
      // back unticked for no reason the user can see.
      useEffect(() => {
        if (state === null) return
        const repoRoot = state.repoRoot ?? null
        const switched = repoRoot !== excludedRepo.current
        excludedRepo.current = repoRoot
        setExcluded((current) => {
          if (switched) return current.size === 0 ? current : new Set()
          if (current.size === 0 || !Array.isArray(state.files)) return current
          const present = new Set(state.files.map((file) => file.path))
          let changed = false
          const next = new Set()
          for (const path of current) {
            if (present.has(path)) next.add(path)
            else changed = true
          }
          return changed ? next : current
        })
      }, [state])

      const openDiff = useCallback(
        (path) => {
          setNotice(null)
          ctx.sidebarRight.openResourceIn(sessionId, DIFF_ADDRESS, {
            params: { source: 'worktree', path, revision: Date.now() },
          })
        },
        [ctx, sessionId],
      )

      const askDiscard = useCallback(
        (paths) => {
          if (state === null) return
          const targets = paths === null ? state.files.map((file) => file.path) : paths
          setPending({
            paths: paths === null ? null : paths,
            files: targets,
            hardDelete: state.prefs?.trashHardDelete === true,
          })
        },
        [state],
      )

      const confirmDiscard = useCallback(() => {
        if (pending === null) return
        const target = pending
        setPending(null)
        void run(
          'discard',
          ACTIONS.DISCARD,
          { paths: target.paths, hardDelete: target.hardDelete },
          (data) => {
            const count = (data.discard?.restored?.length ?? 0) + (data.discard?.deleted?.length ?? 0)
            flash('ok', target.hardDelete ? t('toast.discarded', { n: count }) : t('toast.trashed', { n: count }))
          },
        )
      }, [pending, run, flash, t])

      const commit = useCallback(
        (andPush) => {
          const action = andPush ? ACTIONS.COMMIT_PUSH : ACTIONS.COMMIT
          // The ticked paths travel with the request: the host commits exactly
          // these, out of a temporary index, without touching the real one. The
          // list is read from the latest payload rather than from a closure, so a
          // status that landed while the user was typing the Summary is honoured.
          const paths = tickedPaths(latest.current.state, excluded)
          void run('commit', action, { summary, description, paths }, (data) => {
            setSummary('')
            setDescription('')
            setDescriptionOpen(false)
            // What was just committed is gone from the list, so its untick has
            // nothing left to apply to. Everything remaining is included, which is
            // what Desktop does after a commit — and a partly-ticked commit leaves
            // the rest ticked, which is the same rule.
            setExcluded(new Set())
            const short = data.commit?.short ?? ''
            if (andPush && data.push?.ok === false) {
              flash('warn', `${t('toast.pushFailed', { commit: short })}：${errorText(t, data.push.error?.code, data.push.error?.message)}`)
              return
            }
            flash('ok', andPush ? `${t('toast.committed', { commit: short })} · ${t('toast.pushed')}` : t('toast.committed', { commit: short }))
          })
        },
        [run, summary, description, flash, t, excluded],
      )

      // Adopt the stored script when it arrives, and when it changes underneath
      // us — but only while the box is untouched, so a reload landing mid-edit
      // cannot replace what the user is typing.
      //
      // Nothing is seeded on the user's behalf. A repository with no script opens
      // an empty box (the placeholder is the only hint), because a box that starts
      // with someone else's shell script in it is a box the user has to read
      // before they can trust it — and an empty box is also the only honest
      // answer to "this repository has no script". Empty therefore means empty,
      // which is what makes clearing a script work.
      //
      // Adoption is driven by a *change* in what the host reports, not by
      // comparing that against `scriptSaved`. Pressing Save moves `scriptSaved`
      // forward immediately, while the last status read still carries the old
      // value; comparing the two would read as "the host disagrees" and blank the
      // box the user just saved.
      const lastRemoteScript = useRef(null)
      const remoteScript = typeof state?.summaryScript === 'string' ? state.summaryScript : ''
      const scriptTouched = scriptDraft !== scriptSaved
      useEffect(() => {
        if (remoteScript === lastRemoteScript.current) return
        lastRemoteScript.current = remoteScript
        if (scriptTouched) return
        setScriptSaved(remoteScript)
        setScriptDraft(remoteScript)
      }, [remoteScript, scriptTouched])

      // The fill button stays quiet until there is something to run. Read from
      // the box as well as the host: pressing Save makes a script exist a moment
      // before the next status read can say so.
      const hasScript = scriptSaved.trim() !== '' || remoteScript.trim() !== ''

      /**
       * Persist the script.
       *
       * `announce` is set by the Save button and by nothing else: a blur is a save
       * the user did not ask to be told about, and a run already says what it did
       * with the output. A failed write gets one sentence rather than an error
       * banner — the text is still in the box, so the fix is to press Save again.
       */
      const saveScript = useCallback(
        async (options = {}) => {
          const announce = options.announce === true
          const next = scriptDraft
          if (next === scriptSaved) {
            // Nothing to write, but the user did press Save. Acknowledging the
            // press is the whole difference between "saved" and "ignored".
            if (announce) flash('ok', t('toast.scriptSaved'))
            return
          }
          const previous = scriptSaved
          setScriptSaved(next)
          try {
            // Per repository, so two projects never share a script.
            await rpc(ACTIONS.SAVE_SCRIPT, { sessionId, script: next }, tab.signal)
            if (announce) flash('ok', t('toast.scriptSaved'))
          } catch {
            // Put the "what is saved" value back, so the box is not marked saved
            // for text the host never got; the draft still holds it, so a retry
            // is one press away.
            setScriptSaved(previous)
            if (announce) flash('warn', t('toast.scriptSaveFailed'))
          }
        },
        [sessionId, tab.signal, scriptDraft, scriptSaved, flash, t],
      )

      const runScript = useCallback(
        async (options = {}) => {
          // The run that happens by itself when the panel comes back is silent:
          // the Summary changing is its own confirmation, and a notice on every
          // return to the tab would be noise. A run the user pressed says so.
          const announce = options.announce !== false
          setBusy('script')
          try {
            // Save first: the box on screen is what the user means to run, and a
            // half-typed script silently ignored would be baffling.
            await saveScript()
            const result = await rpc(ACTIONS.RUN_SCRIPT, { sessionId }, tab.signal)
            if (!alive.current) return
            if (result.ran !== true) return
            const { summary: filled, description: body } = splitScriptOutput(result.stdout)
            setSummary(filled)
            // Remembered so a return to the panel can tell a Summary the script
            // wrote from one the user typed: only the former may be replaced.
            scriptFilled.current = filled
            if (body !== '') {
              setDescription(body)
              setDescriptionOpen(true)
            }
            setError(null)
            if (result.exitCode !== 0) {
              flash('warn', t('toast.scriptFailed', { code: result.exitCode ?? '?' }))
            } else if (announce) {
              // A clean exit that printed nothing is still worth a word: the
              // Summary did not change, so nothing else would show the script ran.
              flash('ok', t('toast.scriptFilled'))
            }
          } catch (failure) {
            if (alive.current && failure?.name !== 'AbortError') {
              setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
            }
          } finally {
            if (alive.current) setBusy(null)
          }
        },
        [sessionId, tab.signal, flash, t, saveScript],
      )

      const runContext = useCallback(() => {
        const action = contextAction(state)
        // The busy kind is the *action*, not a constant `'context'`: the header
        // spins on the same one button for both verbs, so a push that reported
        // "正在Fetch…" would be a plain lie about what is running.
        void run(action === ACTIONS.PUSH ? 'push' : 'fetch', action, undefined, (data) => {
          if (action === ACTIONS.PUSH) {
            flash('ok', data.outcome?.published === true ? t('toast.published') : t('toast.pushed'))
          } else {
            flash('ok', t('toast.fetched'))
          }
        })
      }, [run, state, flash, t])

      const openTrash = useCallback(() => {
        ctx.sidebarRight.openTabIn(sessionId, TRASH_KIND)
      }, [ctx, sessionId])

      // Refresh whenever the panel is looked at again, and let the Summary script
      // run as part of that. This is the behaviour the panel is asked for, and it
      // is the one that matters: leave the sidebar open, go and let the agent work
      // in the conversation, come back — the file list already shows what changed
      // and the Summary is already filled.
      //
      // "Looked at again" has to cover *opening* the panel, not just returning to
      // one that stayed mounted, and it cannot be `tab.visible` alone either. In
      // this shell `visible` is true for as long as the sidebar is expanded and
      // this is the pane's active tab — the steady state while the user chats
      // beside it — so returning from the conversation, switching back to the
      // window, or simply pressing into the panel changes nothing at all. The panel
      // therefore treats all of these as a return:
      //
      //   * mounting (the tab was closed and opened again, or the column was
      //     collapsed and expanded — a fresh mount reads and fills at once);
      //   * the tab coming back into view (switching tabs within the column);
      //   * the window, or the browser tab, gaining focus;
      //   * a press that starts outside the panel and lands inside it;
      //   * keyboard focus arriving from outside it.
      //
      // GitHub Desktop does *not* refresh on window focus — its focus handler only
      // tracks the resize handle — and it refreshes on repository switch plus an
      // hourly rhythm. The panel follows the explicit request here, because a DSH
      // sidebar lives beside a chat the agent is working in, and a list that is
      // stale until the user finds the refresh button is the failure that hurts.
      //
      // `runScript` is read through a ref rather than listed as a dependency: it
      // changes identity on every render of the script editor (a keystroke changes
      // the draft, which changes `saveScript`, which changes `runScript`), and any
      // effect depending on it would be rebuilt per typed character.
      const latestScript = useRef({ runScript: () => {} })
      latestScript.current = { runScript }

      // What the script last put in the Summary, and what the box holds now, also
      // read through refs. A return refills only an empty Summary or one that still
      // holds exactly what the script itself wrote: overwriting a message the user
      // typed would be data loss dressed up as helpfulness.
      const scriptFilled = useRef('')
      const formNow = useRef({ summary: '' })
      formNow.current = { summary }

      const rootRef = useRef(null)
      const pendingReturn = useRef(null)
      const lastReturnAt = useRef(0)
      /** Whether the last press was inside the panel; a press inside after one outside is a return. */
      const pressInside = useRef(true)

      /**
       * The user is looking at the panel again — opened it, came back to it, or
       * pressed something in it: re-read the list, then let the script fill the
       * Summary.
       *
       * Delayed, because a press that lands on a control also starts that control's
       * action and a status read racing a commit would adopt a snapshot taken
       * before it. The delay is short enough to be invisible and long enough for
       * the action to claim the panel (`busy`), which then cancels this. The
       * cooldown keeps a burst of events — press, focus, visibility — from becoming
       * a burst of git commands.
       */
      const returnSoon = useCallback(() => {
        if (pendingReturn.current !== null) return
        const run = () => {
          pendingReturn.current = null
          const current = latest.current
          if (!alive.current || current.visible !== true) return
          // A user action is in flight; its own response carries a fresh status.
          if (current.busy !== null) return
          const now = Date.now()
          if (now - lastReturnAt.current < 1200) return
          lastReturnAt.current = now
          // Quiet when there is already something on screen, so a return does not
          // flash the loading state over a list the user recognises.
          void load({ quiet: current.state !== null }).then((data) => {
            if (data === false) return
            // After the list, not before: the script may read the tree, and the
            // Summary should describe what is on screen.
            //
            // The script and the form are read from `data` and from refs rather
            // than from this render's closure. The continuation runs before React
            // re-renders, so on the panel's FIRST open the closure still holds the
            // pre-load snapshot — no script, an empty Summary — and every return
            // would decide "nothing to fill" from values one round behind the list
            // it just read.
            const script = typeof data?.summaryScript === 'string' ? data.summaryScript.trim() : ''
            if (script === '') return
            const filled = formNow.current.summary
            if (filled !== '' && filled !== scriptFilled.current) return
            void latestScript.current.runScript({ announce: false })
          })
        }
        // Nothing on screen yet: this is the panel opening, and the read is what
        // renders it at all, so it must not wait for anything.
        if (latest.current.state === null) {
          run()
          return
        }
        pendingReturn.current = setTimeout(run, 150)
      }, [load])

      useEffect(
        () => () => {
          if (pendingReturn.current !== null) clearTimeout(pendingReturn.current)
        },
        [],
      )

      // The window, and the browser tab, coming back.
      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onFocus = () => returnSoon()
        const onVisibility = () => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') returnSoon()
        }
        window.addEventListener('focus', onFocus)
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        return () => {
          window.removeEventListener('focus', onFocus)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }
      }, [returnSoon])

      // Presses, in the capture phase on the window: that runs before the panel's
      // own handlers and before any action the press starts, which is what makes
      // "this press came from outside" answerable.
      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onPress = (event) => {
          const root = rootRef.current
          const target = event === null || event === undefined ? undefined : event.target
          if (root === null || typeof root.contains !== 'function') return
          if (target === undefined || target === null) return
          const inside = root.contains(target)
          if (inside && !pressInside.current) returnSoon()
          pressInside.current = inside
        }
        window.addEventListener('pointerdown', onPress, true)
        return () => window.removeEventListener('pointerdown', onPress, true)
      }, [returnSoon])

      // Keyboard focus arriving from elsewhere counts as a return too, and marks the
      // panel as where the user is working.
      const onPanelFocus = useCallback(
        (event) => {
          const root = rootRef.current
          if (root === null || typeof root.contains !== 'function') return
          const from = event === null || event === undefined ? undefined : event.relatedTarget
          if (from !== undefined && from !== null && root.contains(from)) return
          pressInside.current = true
          returnSoon()
        },
        [returnSoon],
      )

      // Every return goes through the one funnel above: the panel opening (a fresh
      // mount, where nothing is on screen yet and the read is what renders it) and
      // the tab coming back into view.
      //
      // A tab that was hidden and is showing again is an explicit "the user opened
      // it", so it clears the cooldown first: the cooldown is there to collapse a
      // burst of overlapping signals, not to drop the one signal that means the
      // panel just appeared.
      const loadedOnce = useRef(false)
      const wasVisible = useRef(false)
      useEffect(() => {
        const visible = tab.visible !== false
        // Tracked on every render, not only on the ones that read: the "were we
        // hidden a moment ago" question has no answer otherwise.
        const appeared = visible && !wasVisible.current
        wasVisible.current = visible
        if (!loadedOnce.current || visible) {
          loadedOnce.current = true
          if (appeared) lastReturnAt.current = 0
          returnSoon()
        }
      }, [tab.visible, sessionId, load, returnSoon])

      const bind = useCallback(
        (repoRoot) => {
          void run('bind', ACTIONS.BIND, { repoRoot }, () => {
            flash('ok', repoRoot === null ? t('toast.unbound') : t('toast.bound'))
          })
        },
        [run, flash, t],
      )

      const rescan = useCallback(async () => {
        setScanning(true)
        try {
          const data = await rpc(ACTIONS.REPOS, { sessionId }, tab.signal)
          if (alive.current) setState((current) => ({ ...(current ?? {}), ...data }))
        } catch (failure) {
          if (alive.current && failure?.name !== 'AbortError') {
            setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
          }
        } finally {
          if (alive.current) setScanning(false)
        }
      }, [sessionId, tab.signal])

      /* ---------------------------------------------------------------- render */

      if (state === null && phase !== 'error') {
        return h('div', { className: 'lite-git-root', 'data-lite-git': 'loading' }, h(Spinner, { label: t('state.loading') }))
      }

      if (state === null && phase === 'error') {
        return h('div', { className: 'lite-git-root', 'data-lite-git': 'error' }, [
          h(Banner, {
            key: 'b',
            tone: 'error',
            text: errorText(t, error?.code, error?.message),
          }),
          h(
            'div',
            { key: 'a', className: 'lite-git-picker' },
            h('button', { type: 'button', className: 'lite-git-btn', onClick: () => void load() }, t('state.retry')),
          ),
        ])
      }

      // Unbound: the workspace is not a repository, so ask which one it is.
      if (state.repoRoot === null || state.repoRoot === undefined) {
        return h('div', { className: 'lite-git-root', 'data-lite-git': 'picker' }, [
          error === null ? null : h(Banner, { key: 'err', tone: 'error', text: errorText(t, error.code, error.message) }),
          notice === null ? null : h(Banner, { key: 'notice', tone: notice.tone, text: notice.text }),
          h(RepositoryPicker, {
            key: 'picker',
            candidates: state.candidates ?? [],
            truncated: state.scanTruncated === true,
            scanning,
            pathInput,
            t,
            bound: null,
            canUnbind: false,
            onPick: (path) => bind(path),
            onPath: () => bind(pathInput),
            onPathChange: setPathInput,
            onRescan: () => void rescan(),
            onUnbind: () => bind(null),
          }),
        ])
      }

      const files = state.files ?? []
      const readiness = commitReadiness(state, summary, busy, excluded)
      const canCommit = readiness.canCommit
      const commitHint = readiness.reasonKey === null ? '' : t(readiness.reasonKey)

      // The header tick, driven by the same rule the rows are: it sets every
      // selectable path to one state at once. No request is involved any more —
      // this is a local choice, which is why it can never fail or arrive late.
      //
      // Deliberately *not* a `useCallback`: it sits below the loading and error
      // early-returns above, and a hook there is called on some renders and not
      // others. React rejects that ("rendered more hooks than during the previous
      // render") and the panel goes blank — which is exactly how 0.5.4 shipped.
      // A plain closure costs nothing here, because `state` changes every render
      // anyway and a memoised copy would be rebuilt regardless.
      const selection = selectionState(state, excluded)
      const toggleAll = () => {
        const paths = selectablePaths(state)
        if (paths.length === 0) return
        setTicked(paths, selection !== 'all')
      }

      return h('div', { className: 'lite-git-root', 'data-lite-git': 'panel', style: { position: 'relative' }, ref: rootRef, onFocus: onPanelFocus }, [
        h('div', { key: 'head', className: 'lite-git-head' }, [
          h('div', { key: 'ident', className: 'lite-git-ident' }, [
            h('span', { key: 'repo', className: 'lite-git-repo', title: state.repoRoot }, state.repoName ?? state.repoRoot),
            h(
              'span',
              { key: 'branch', className: 'lite-git-branch', title: state.branch?.head ?? '' },
              state.branch?.detached === true ? `(${state.branch?.head ?? ''})` : state.branch?.head ?? '',
            ),
            state.branch !== undefined && (state.branch.ahead > 0 || state.branch.behind > 0)
              ? h('span', { key: 'ab', className: 'lite-git-ab' }, `↑${state.branch.ahead} ↓${state.branch.behind}`)
              : null,
          ]),
          h('div', { key: 'tools', className: 'lite-git-tools' }, [
            // While an action is in flight the header says so, in the place the
            // user just pressed. Push and fetch are network round trips that can
            // take tens of seconds, and until now the only feedback was a
            // greyed-out button — indistinguishable from a panel that had
            // stopped responding. The context button *becomes* the spinner: it
            // is the control whose action is running, and swapping it in place
            // keeps the row the same height and the eye on the same spot.
            busy !== null
              ? h(
                  'span',
                  {
                    key: 'ctx',
                    className: 'lite-git-busy',
                    role: 'status',
                    'aria-live': 'polite',
                    'data-lite-git-busy': busy,
                  },
                  [h(LoadingGlyph, { key: 's' }), h('span', { key: 't', className: 'lite-git-busyText' }, busyLabel(busy, t))],
                )
              : h(
                  IconButton,
                  {
                    key: 'ctx',
                    label: t(contextLabelKey(state)),
                    onClick: runContext,
                    className: 'lite-git-contextBtn',
                    attrs: { 'data-lite-git-context': state.primary ?? 'fetch' },
                  },
                  h('span', { style: { whiteSpace: 'nowrap' } }, t(contextLabelKey(state))),
                ),
            // Hidden while busy: the spinner needs the room, and "last fetch: 3
            // minutes ago" is the least useful thing on the row during a fetch.
            busy !== null
              ? null
              : h(
                  'span',
                  { key: 'last', className: 'lite-git-lastFetch', 'data-lite-git-lastfetch': state.lastFetchAt ?? '' },
                  lastFetchLabel(state, Date.now(), t),
                ),
            h(
              IconButton,
              { key: 'refresh', label: t('action.refresh'), disabled: busy !== null, onClick: () => void refresh() },
              h(RefreshGlyph, {}),
            ),
            h(IconButton, { key: 'trash', label: t('action.trash'), onClick: openTrash }, h(TrashGlyph, {})),
            h(
              IconButton,
              {
                key: 'rebind',
                // Unbinding means "forget which repository this workspace was
                // pointed at". When the workspace *is* that repository's root
                // there is nothing to forget: the next read re-detects the very
                // same directory, so the button would report success and change
                // nothing. It is greyed out instead, and its title says why.
                label: state.workspaceIsRepoRoot === true ? t('action.unbindHere') : t('action.rebind'),
                disabled: busy !== null || state.workspaceIsRepoRoot === true,
                onClick: () => bind(null),
                attrs: { 'data-lite-git-rebind': state.workspaceIsRepoRoot === true ? 'here' : 'bound' },
              },
              h(UnlinkGlyph, {}),
            ),
          ]),
        ]),

        error === null ? null : h(Banner, { key: 'err', tone: 'error', text: errorText(t, error.code, error.message), onClose: () => setError(null), closeLabel: t('action.cancel') }),
        notice === null ? null : h(Banner, { key: 'notice', tone: notice.tone, text: notice.text }),

        h('div', { key: 'sub', className: 'lite-git-sub' }, [
          // The header's tick, sitting where the eye already is: above the row
          // ticks and left of the count. It is a tri-state box, not a button,
          // because it answers the same question each row's tick answers, and it
          // needs to be able to say "some" — a two-state control would either lie
          // about a partial selection or throw one away.
          h(
            'button',
            {
              key: 'selectall',
              type: 'button',
              className: `lite-git-tick lite-git-tick-header${selection === 'all' ? ' lite-git-tick-on' : selection === 'some' ? ' lite-git-tick-partial' : ''}`,
              'data-lite-git-selectall': selection,
              role: 'checkbox',
              'aria-checked': selection === 'all' ? 'true' : selection === 'some' ? 'mixed' : 'false',
              title: selection === 'all' ? t('changes.unselectAll') : t('changes.selectAll'),
              'aria-label': selection === 'all' ? t('changes.unselectAll') : t('changes.selectAll'),
              disabled: selection === 'empty' || busy !== null,
              onClick: () => toggleAll(),
            },
            selection === 'all' ? h(CheckGlyph, { size: 11 }) : selection === 'some' ? h('span', {}) : null,
          ),
          h('span', { key: 'title', className: 'lite-git-subTitle' }, t('changes.title')),
          h(
            'span',
            { key: 'stats', className: 'lite-git-subStats' },
            t('changes.summary', { files: files.length, staged: stagedCount(state, excluded) }),
          ),
          hasConflict(state)
            ? h('span', { key: 'warn', className: 'lite-git-ab', title: t('err.E_CONFLICT') }, '⚠')
            : null,
          h(
            'button',
            {
              key: 'all',
              type: 'button',
              className: 'lite-git-btn',
              'data-lite-git-discardall': '',
              disabled: files.length === 0 || busy !== null,
              onClick: () => askDiscard(null),
            },
            t('action.discardAll'),
          ),
        ]),

        h(
          'div',
          { key: 'list', className: 'lite-git-list', 'data-lite-git-list': '' },
          files.length === 0
            ? h('div', { className: 'lite-git-empty' }, t('changes.empty'))
            : files.map((file) =>
                h(ChangeRow, {
                  key: file.path,
                  file,
                  t,
                  ticked: !(excluded !== undefined && excluded.has(file.path)) && file.conflicted !== true,
                  onToggle: toggle,
                  onDiscard: (path) => askDiscard([path]),
                  onOpen: openDiff,
                }),
              ),
        ),

        h('div', { key: 'commit', className: 'lite-git-commit' }, [
          h('div', { key: 'summary', className: 'lite-git-summaryRow' }, [
            h('input', {
              key: 'input',
              className: 'lite-git-input',
              placeholder: t('commit.summaryPlaceholder'),
              value: summary,
              'data-lite-git-summary': '',
              disabled: busy !== null,
              onChange: (event) => setSummary(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit) commit(false)
              },
            }),
            // Fills the Summary (and the Description) from the user's script.
            // Rendered only when there is a script, so the row stays quiet for a
            // panel that never uses one — the way to *write* the script is the
            // button under the Description field below.
            hasScript
              ? h(
                  'button',
                  {
                    key: 'fill',
                    type: 'button',
                    className: 'lite-git-disclose',
                    title: t('commit.runScript'),
                    'aria-label': t('commit.runScript'),
                    'data-lite-git-runscript': '',
                    disabled: busy !== null,
                    onClick: () => void runScript({ announce: true }),
                  },
                  h(WandGlyph, { size: 13 }),
                )
              : null,
            h(
              'button',
              {
                key: 'disclose',
                type: 'button',
                className: `lite-git-disclose${descriptionOpen ? ' lite-git-disclose-open' : ''}`,
                title: descriptionOpen ? t('commit.collapse') : t('commit.expand'),
                'aria-label': descriptionOpen ? t('commit.collapse') : t('commit.expand'),
                'aria-expanded': descriptionOpen ? 'true' : 'false',
                'data-lite-git-describe': '',
                onClick: () => setDescriptionOpen((open) => !open),
              },
              h(ChevronRightGlyph, { size: 13 }),
            ),
          ]),
          descriptionOpen
            ? h('textarea', {
                key: 'description',
                className: 'lite-git-input',
                placeholder: t('commit.descriptionPlaceholder'),
                value: description,
                'data-lite-git-description': '',
                disabled: busy !== null,
                onChange: (event) => setDescription(event.target.value),
              })
            : null,
          // The script that can fill the boxes, written here rather than in a
          // settings form: it is multi-line shell, which no form field expresses
          // well, and it belongs next to the thing it fills.
          //
          // Only once the Description area is open. The summary row stays a single
          // line — that is the shape asked for, and it keeps the field a field
          // rather than the top of a form.
          descriptionOpen
            ? h(
                'button',
                {
                  key: 'script',
                  type: 'button',
                  className: 'lite-git-scriptToggle',
                  'data-lite-git-scripttoggle': scriptOpen ? 'open' : 'closed',
                  'aria-expanded': scriptOpen ? 'true' : 'false',
                  title: t('commit.scriptToggle'),
                  onClick: () => setScriptOpen((open) => !open),
                },
                h(WandGlyph, { size: 12 }),
                h('span', { key: 'l' }, t('commit.scriptToggle')),
              )
            : null,
          descriptionOpen && scriptOpen
            ? h('div', { key: 'scriptbox', className: 'lite-git-scriptBox' }, [
                h('textarea', {
                  key: 'editor',
                  className: 'lite-git-input lite-git-scriptEditor',
                  placeholder: t('commit.scriptPlaceholder'),
                  value: scriptDraft,
                  'data-lite-git-script': '',
                  spellCheck: false,
                  onChange: (event) => setScriptDraft(event.target.value),
                  onBlur: () => void saveScript(),
                }),
                h('div', { key: 'row', className: 'lite-git-scriptRow' }, [
                  h('span', { key: 'hint', className: 'lite-git-scriptHint' }, t('commit.scriptHint')),
                  h('span', { key: 'spacer', className: 'lite-git-spacer' }),
                  h(
                    'button',
                    {
                      key: 'save',
                      type: 'button',
                      className: 'lite-git-btn',
                      'data-lite-git-scriptsave': '',
                      disabled: busy !== null,
                      onClick: () => void saveScript({ announce: true }),
                    },
                    t('commit.scriptSave'),
                  ),
                  h(
                    'button',
                    {
                      key: 'run',
                      type: 'button',
                      className: 'lite-git-btn lite-git-btn-primary',
                      'data-lite-git-scriptrun': '',
                      disabled: busy !== null || scriptDraft.trim() === '',
                      onClick: () => void runScript({ announce: true }),
                    },
                    t('commit.scriptRun'),
                  ),
                ]),
              ])
            : null,
          h('div', { key: 'actions', className: 'lite-git-actions' }, [
            h(
              'button',
              {
                key: 'commit',
                type: 'button',
                className: 'lite-git-btn',
                title: canCommit ? '' : commitHint,
                disabled: !canCommit,
                'data-lite-git-commit': '',
                onClick: () => commit(false),
              },
              t('commit.commit'),
            ),
            h(
              'button',
              {
                key: 'push',
                type: 'button',
                className: 'lite-git-btn lite-git-btn-primary',
                title: canCommit ? '' : commitHint,
                disabled: !canCommit,
                'data-lite-git-commitpush': '',
                onClick: () => commit(true),
              },
              t('commit.commitAndPush'),
            ),
          ]),
        ]),

        h(DiscardDialog, {
          key: 'dialog',
          pending,
          t,
          onCancel: () => setPending(null),
          onHardDeleteChange: (hardDelete) => setPending((current) => (current === null ? null : { ...current, hardDelete })),
          onConfirm: confirmDiscard,
        }),
      ])
    }

    /* ------------------------------------------------------------------ *
     * 9. The trash tab
     * ------------------------------------------------------------------ */

    function TrashBody(props) {
      const t = props.t ?? fallbackTranslate()
      const ctx = props.ctx
      const tab = props.useTabInfo().tab
      const sessionId = props.sessionId ?? tab.sessionId

      const [state, setState] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [confirmClear, setConfirmClear] = useState(false)
      const [showAll, setShowAll] = useState(null)
      // Restoring, deleting and emptying all change the list the user is looking
      // at, and a row that simply disappears (or a working tree that simply gains
      // a file) is easy to miss for an action this hard to undo by hand. One line
      // of confirmation is the whole feature.
      const [notice, setNotice] = useState(null)

      const load = useCallback(
        async (options = {}) => {
          if (options.quiet !== true) setPhase('loading')
          try {
            const data = await rpc(ACTIONS.TRASH_LIST, { sessionId, ...(options.all === undefined ? {} : { all: options.all }) }, tab.signal)
            setState(data)
            setShowAll(data.showAll === true)
            setError(null)
            setPhase('ready')
            return true
          } catch (failure) {
            if (failure?.name === 'AbortError') return false
            setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
            setPhase('error')
            return false
          }
        },
        [sessionId, tab.signal],
      )

      // The same rule as the panel's refresh: a re-read that worked says so,
      // because an unchanged list looks identical whether or not anything ran.
      const refresh = useCallback(async () => {
        if (await load({ quiet: true })) setNotice(t('toast.refreshed'))
      }, [load, t])

      const wasVisible = useRef(false)
      useEffect(() => {
        const visible = tab.visible !== false
        if (!wasVisible.current || visible) {
          wasVisible.current = true
          void load({ quiet: state !== null })
        }
      }, [tab.visible, sessionId])

      useEffect(() => tab.actions.bindCommands({ refresh: () => void refresh() }), [tab.actions, refresh])

      const openEntry = useCallback(
        (entry) => {
          ctx.sidebarRight.openResourceIn(sessionId, DIFF_ADDRESS, {
            params: { source: 'trash', id: entry.id, revision: Date.now() },
          })
        },
        [ctx, sessionId],
      )

      // Restoring, deleting and emptying are the same shape — mark one row busy,
      // call one action, re-read, say what happened — so they are one function
      // with the differences passed in. Three copies of this had three chances to
      // forget the notice, and two of them had.
      const perform = useCallback(
        async (busyKey, action, payload, doneText) => {
          setBusy(busyKey)
          try {
            const data = await rpc(action, { sessionId, ...(payload ?? {}) }, tab.signal)
            setNotice(doneText(data))
            setError(null)
            await load({ quiet: true })
          } catch (failure) {
            if (failure?.name !== 'AbortError') setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
          } finally {
            setBusy(null)
          }
        },
        [sessionId, load, tab.signal],
      )

      const removeEntry = useCallback(
        (entry) => perform(entry.id, ACTIONS.TRASH_DELETE, { id: entry.id }, () => t('toast.trashDeleted')),
        [perform, t],
      )

      // Restoring is offered only when the working tree still matches what the
      // discard left behind, which the host decides and reports per entry. The
      // check is re-run server side inside the action, so a row that renders as
      // enabled cannot fail and a row that renders as disabled cannot lie.
      const restoreEntry = useCallback(
        (entry) =>
          perform(entry.id, ACTIONS.TRASH_RESTORE, { id: entry.id }, (data) =>
            t('toast.trashRestored', { n: Array.isArray(data?.restored?.restored) ? data.restored.restored.length : 0 }),
          ),
        [perform, t],
      )

      const clearAll = useCallback(async () => {
        setConfirmClear(false)
        await perform('clear', ACTIONS.TRASH_CLEAR, { all: showAll === true }, (data) =>
          t('toast.trashCleared', { n: typeof data?.removed === 'number' ? data.removed : 0 }),
        )
      }, [perform, showAll, t])

      const toggleShowAll = useCallback(
        async (next) => {
          setShowAll(next)
          try {
            await rpc(ACTIONS.PREFS, { sessionId, trashShowAllRepos: next }, tab.signal)
          } catch {
            // A preference that failed to persist is not worth an error banner.
          }
          await load({ quiet: true, all: next })
        },
        [sessionId, load, tab.signal],
      )

      if (state === null && phase !== 'error') {
        return h('div', { className: 'lite-git-root', 'data-lite-git-trash': 'loading' }, h(Spinner, { label: t('state.loading') }))
      }
      if (state === null) {
        return h('div', { className: 'lite-git-root', 'data-lite-git-trash': 'error' }, [
          h(Banner, { key: 'b', tone: 'error', text: errorText(t, error?.code, error?.message) }),
          h('div', { key: 'a', className: 'lite-git-picker' }, h('button', { type: 'button', className: 'lite-git-btn', onClick: () => void load() }, t('state.retry'))),
        ])
      }

      const entries = state.entries ?? []
      const now = Date.now()

      return h('div', { className: 'lite-git-root', 'data-lite-git-trash': 'ready', style: { position: 'relative' } }, [
        h('div', { key: 'head', className: 'lite-git-head' }, [
          h('div', { key: 'ident', className: 'lite-git-ident' }, [
            h('span', { key: 'title', className: 'lite-git-repo' }, t('trash.title')),
            h('span', { key: 'count', className: 'lite-git-branch' }, t('trash.count', { n: entries.length })),
          ]),
          h('div', { key: 'tools', className: 'lite-git-tools' }, [
            h(IconButton, { key: 'refresh', label: t('action.refresh'), disabled: busy !== null, onClick: () => void refresh() }, h(RefreshGlyph, {})),
          ]),
        ]),

        error === null ? null : h(Banner, { key: 'err', tone: 'error', text: errorText(t, error.code, error.message), onClose: () => setError(null), closeLabel: t('action.cancel') }),
        notice === null ? null : h(Banner, { key: 'ok', tone: 'ok', text: notice, onClose: () => setNotice(null), closeLabel: t('action.cancel') }),

        h('div', { key: 'sub', className: 'lite-git-sub' }, [
          h('label', { key: 'toggle', className: 'lite-git-toggle' }, [
            h('input', {
              type: 'checkbox',
              checked: showAll === true,
              'data-lite-git-showall': '',
              onChange: (event) => void toggleShowAll(event.target.checked),
            }),
            h('span', { key: 'l' }, showAll === true ? t('trash.showAll') : t('trash.onlyThis')),
          ]),
          h('span', { key: 'spacer', className: 'lite-git-spacer' }),
          h(
            'button',
            {
              key: 'clear',
              type: 'button',
              className: 'lite-git-btn lite-git-btn-danger',
              disabled: entries.length === 0 || busy !== null,
              'data-lite-git-clear': '',
              onClick: () => setConfirmClear(true),
            },
            t('action.clear'),
          ),
        ]),

        h(
          'div',
          { key: 'list', className: 'lite-git-list', 'data-lite-git-trashlist': '' },
          entries.length === 0
            ? h('div', { className: 'lite-git-empty' }, t('trash.empty'))
            : entries.map((entry) => {
                const added = (entry.files ?? []).reduce((sum, file) => sum + (file.added ?? 0), 0)
                const deleted = (entry.files ?? []).reduce((sum, file) => sum + (file.deleted ?? 0), 0)
                const base = entry.base === null || entry.base === undefined ? '' : `#${entry.base.short ?? ''}`
                return h('div', { key: entry.id, className: 'lite-git-row', style: { alignItems: 'stretch', padding: 0 } }, [
                  h(
                    'button',
                    {
                      key: 'open',
                      type: 'button',
                      className: 'lite-git-trashRow',
                      'data-lite-git-entry': entry.id,
                      title: t('diff.trashEntry'),
                      onClick: () => openEntry(entry),
                    },
                    h('span', { className: 'lite-git-trashBody' }, [
                      h('span', { key: 'head', className: 'lite-git-trashHead' }, [
                        h('span', { key: 'when', className: 'lite-git-trashWhen' }, formatRelative(entry.at, now, t)),
                        h(
                          'span',
                          { key: 'scope', className: 'lite-git-badge' },
                          entry.scope === 'all' ? t('trash.scope.all') : t('trash.scope.file'),
                        ),
                        entry.truncated === true ? h('span', { key: 'trunc', className: 'lite-git-badge' }, '…') : null,
                      ]),
                      h(
                        'span',
                        { key: 'detail', className: 'lite-git-trashMeta' },
                        t('trash.detail', { files: (entry.files ?? []).length, added, deleted }),
                      ),
                      h(
                        'span',
                        { key: 'base', className: 'lite-git-trashFiles' },
                        [base === '' ? '' : t('trash.base', { commit: base }), entry.base?.subject === undefined ? '' : ` · ${entry.base.subject}`].join(''),
                      ),
                      h(
                        'span',
                        { key: 'files', className: 'lite-git-trashFiles', title: (entry.files ?? []).map((file) => file.path).join('\n') },
                        (entry.files ?? []).map((file) => shortPath(file.path)).slice(0, 3).join(' · '),
                      ),
                      // Why restoring is off, when it is: the archive outlived the
                      // state it was taken from.
                      entry.restorable?.ok === true
                        ? null
                        : h('span', { key: 'why', className: 'lite-git-trashWhy' }, restoreReasonText(t, entry.restorable?.reason)),
                    ]),
                  ),
                  h(
                    'span',
                    { key: 'act', style: { flex: 'none', display: 'flex', alignItems: 'flex-start', padding: '7px 4px 0 0' } },
                    h(
                      IconButton,
                      {
                        key: 'restore',
                        label: t('action.restore'),
                        disabled: busy !== null || entry.restorable?.ok !== true,
                        onClick: () => void restoreEntry(entry),
                        attrs: { 'data-lite-git-restore': entry.id },
                      },
                      h(RestoreGlyph, { size: 14 }),
                    ),
                  ),
                  h(
                    'span',
                    { key: 'del', style: { flex: 'none', display: 'flex', alignItems: 'flex-start', padding: '7px 6px 0 0' } },
                    h(
                      IconButton,
                      {
                        label: t('action.delete'),
                        disabled: busy !== null,
                        onClick: () => void removeEntry(entry),
                        attrs: { 'data-lite-git-trashtrash': entry.id },
                      },
                      h(TrashGlyph, { size: 14 }),
                    ),
                  ),
                ])
              }),
        ),

        confirmClear
          ? h('div', { className: 'lite-git-overlay', 'data-lite-git-dialog': 'clear' }, [
              h('div', { className: 'lite-git-dialog', role: 'dialog', 'aria-modal': 'true' }, [
                h('div', { key: 'title', className: 'lite-git-dialogTitle' }, t('trash.clearConfirm', { n: entries.length })),
                h('div', { key: 'hint', className: 'lite-git-checkHint' }, t('trash.clearHint')),
                h('div', { key: 'actions', className: 'lite-git-dialogActions' }, [
                  h('button', { key: 'cancel', type: 'button', className: 'lite-git-btn', onClick: () => setConfirmClear(false) }, t('action.cancel')),
                  h(
                    'button',
                    { key: 'go', type: 'button', className: 'lite-git-btn lite-git-btn-danger', 'data-lite-git-clearcancel': '', onClick: () => void clearAll() },
                    t('action.clear'),
                  ),
                ]),
              ]),
            ])
          : null,
      ])
    }

    /* ------------------------------------------------------------------ *
     * 10. The diff tab
     * ------------------------------------------------------------------ */

    /** Whatever the diff tab was last asked to show. */
    function diffTarget(params) {
      if (params === null || typeof params !== 'object') return null
      if (params.source === 'trash' && typeof params.id === 'string' && params.id !== '') {
        return { source: 'trash', id: params.id }
      }
      if (typeof params.path === 'string' && params.path !== '') {
        return { source: 'worktree', path: params.path }
      }
      return null
    }

    function DiffBody(props) {
      const t = props.t ?? fallbackTranslate()
      const tab = props.useTabInfo().tab
      const sessionId = props.sessionId ?? tab.sessionId
      const navigation = tab.navigation ?? {}
      const target = diffTarget(navigation.params)
      const revision = navigation.revision ?? 0

      const [state, setState] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      // The open-with menu: what this machine can open a file with, whether the
      // menu is showing, and the one-line answer after a press. Three pieces of
      // state rather than one object, so a press cannot clear the list.
      const [openers, setOpeners] = useState(null)
      const [menuOpen, setMenuOpen] = useState(false)
      const [notice, setNotice] = useState(null)
      // "Hide whitespace changes": git re-diffs with `-w`, so what comes back is
      // the change without its whitespace. Kept per tab rather than persisted:
      // it is a way of reading one diff, not a setting for how diffs are read.
      const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
      // Which gaps have had lines pulled in, and from which edge: `from` →
      // `{ down, up }`, the number of lines taken from the top and the bottom.
      // Per gap, and per edge, because the two buttons answer two different
      // questions — "what is just above this hunk" and "what is just below that
      // one" — and a single "open" flag could only answer both at once.
      const [expanded, setExpanded] = useState(null)
      // The lines the host has sent for each gap, `from` → { lineNumber: text }.
      const [gapText, setGapText] = useState(null)

      // Every hook in this body stays above the loading and error returns below:
      // those two render a different set otherwise, and React blanks the tab.
      const openable = target !== null && target.source !== 'trash'

      const load = useCallback(async () => {
        if (target === null) {
          setState({ text: '', added: 0, deleted: 0, binary: false, truncated: false })
          setPhase('ready')
          return
        }
        setPhase('loading')
        try {
          if (target.source === 'trash') {
            const data = await rpc(ACTIONS.TRASH_DIFF, { sessionId, id: target.id }, tab.signal)
            setState({ text: data.text, added: 0, deleted: 0, binary: false, truncated: data.entry?.truncated === true })
          } else {
            const data = await rpc(ACTIONS.FILE_DIFF, { sessionId, path: target.path, ignoreWhitespace }, tab.signal)
            setState(data.diff)
          }
          setError(null)
          setPhase('ready')
        } catch (failure) {
          if (failure?.name === 'AbortError') return
          setError({ code: failure.code ?? 'E_UNKNOWN', message: failure.message })
          setPhase('error')
        }
      }, [sessionId, tab.signal, target?.source, target?.id, target?.path, revision, ignoreWhitespace])

      useEffect(() => {
        void load()
      }, [load])

      /**
       * Pull `GAP_STEP` more lines into one edge of a gap.
       *
       * `edge` is `'down'` (lines just below the hunk above) or `'up'` (lines
       * just above the hunk below). Each press asks the host for exactly the
       * next 20 lines of that edge, so a press costs one small request rather
       * than re-fetching the whole run — and the state is a count per edge, so
       * pressing both buttons leaves the gap's two ends growing towards each
       * other instead of fighting over one flag.
       *
       * The host's answer is stored by line number: the two edges are different
       * ranges of the same file, and keying by number means neither can overwrite
       * the other's text.
       */
      const expandGap = useCallback(
        async (gap) => {
          if (target === null) return
          const key = `${gap.from}`
          const total = gap.to - gap.from + 1
          const state = (expanded === null ? undefined : expanded[key]) ?? { down: 0, up: 0 }
          const edge = gap.edge === 'up' ? 'up' : 'down'
          const taken = state.down + state.up
          const step = Math.min(GAP_STEP, total - taken)
          if (step <= 0) return

          // The range this press adds, in old-file line numbers.
          const from = edge === 'down' ? gap.from + state.down : gap.to - state.up - step + 1
          const to = edge === 'down' ? gap.from + state.down + step - 1 : gap.to - state.up
          // Optimistic: the lines appear as soon as they arrive, and a failure
          // puts the count back where it was.
          setExpanded((current) => ({
            ...(current ?? {}),
            [key]: edge === 'down' ? { ...state, down: state.down + step } : { ...state, up: state.up + step },
          }))
          try {
            const data = await rpc(
              ACTIONS.FILE_CONTEXT,
              { sessionId, path: target.path, from, to, ignoreWhitespace },
              tab.signal,
            )
            const received = data.context.lines ?? []
            setGapText((current) => {
              const next = { ...(current ?? {}) }
              const lines = { ...(next[key] ?? {}) }
              for (let i = 0; i < received.length; i += 1) lines[from + i] = received[i]
              next[key] = lines
              return next
            })
          } catch (failure) {
            if (failure?.name === 'AbortError') return
            setExpanded((current) => ({ ...(current ?? {}), [key]: state }))
            setNotice({ tone: 'error', text: errorText(t, failure?.code, failure?.message) })
          }
        },
        [sessionId, tab.signal, target?.path, ignoreWhitespace, expanded, t],
      )

      useEffect(() => tab.actions.bindCommands({ refresh: () => void load() }), [tab.actions, load])

      // What this machine can open a file with, asked once: the answer is about
      // the host, not about the file, and a menu that changed under the pointer
      // would be worse than a stale one. A failure is silent — the button simply
      // does not appear, which is honest on a host that has nothing to offer.
      useEffect(() => {
        if (!openable) return undefined
        let live = true
        rpc(ACTIONS.OPENERS, {}, tab.signal)
          .then((data) => {
            if (!live) return
            const list = Array.isArray(data.openers) ? data.openers.filter((row) => typeof row?.id === 'string') : []
            if (list.length === 0) return
            const last = typeof data.last === 'string' && list.some((row) => row.id === data.last) ? data.last : list[0].id
            setOpeners({ list, last })
          })
          .catch(() => {
            if (live) setOpeners(null)
          })
        return () => {
          live = false
        }
      }, [openable, tab.signal])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 6000)
        return () => clearTimeout(timer)
      }, [notice])

      /**
       * Open the file with one program, and say what happened.
       *
       * The choice is what the button remembers afterwards: the host records it
       * as a preference, and this local copy moves with it so the next press
       * uses the program the user just picked without a fresh read.
       */
      const openWith = useCallback(
        async (id) => {
          if (!openable || typeof id !== 'string' || id === '') return
          setMenuOpen(false)
          setNotice(null)
          try {
            const data = await rpc(ACTIONS.OPEN_FILE, { sessionId, path: target.path, opener: id }, tab.signal)
            const used = typeof data.opened?.id === 'string' ? data.opened.id : id
            const named = openers?.list.find((row) => row.id === used) ?? { id: used }
            setOpeners((current) => (current === null ? current : { ...current, last: used }))
            setNotice({ tone: 'ok', text: t('open.done', { app: openerName(t, named) }) })
          } catch (failure) {
            if (failure?.name === 'AbortError') return
            setNotice({ tone: 'error', text: errorText(t, failure?.code, failure?.message) })
          }
        },
        [openable, sessionId, tab.signal, target?.path, openers, t],
      )

      const rows = useMemo(() => (state === null ? [] : diffRows(state.text)), [state])

      // Which file headers have been expanded to show git's raw lines. Keyed by
      // row index: the rows are rebuilt whenever the diff is re-read, and an
      // index is stable across that rebuild for the file it names.
      const [rawOpen, setRawOpen] = useState(null)

      // The per-file totals the header card shows. Counted from the classified
      // rows rather than from the payload's `added`/`deleted`, which are for the
      // whole diff — a file blob can hold several files.
      const fileTotals = useMemo(() => {
        const totals = new Map()
        let current = -1
        for (const row of rows) {
          if (row.kind === 'file') {
            current += 1
            totals.set(current, { added: 0, deleted: 0 })
            continue
          }
          if (current < 0) continue
          const entry = totals.get(current)
          if (row.kind === 'add') entry.added += 1
          else if (row.kind === 'del') entry.deleted += 1
        }
        return totals
      }, [rows])

      if (phase === 'loading' && state === null) {
        return h('div', { className: 'lite-git-root', 'data-lite-git-diff': 'loading' }, h(Spinner, { label: t('diff.loading') }))
      }
      if (phase === 'error') {
        return h('div', { className: 'lite-git-root', 'data-lite-git-diff': 'error' }, [
          h(Banner, { key: 'b', tone: 'error', text: errorText(t, error?.code, error?.message) }),
          h('div', { key: 'a', className: 'lite-git-picker' }, h('button', { type: 'button', className: 'lite-git-btn', onClick: () => void load() }, t('state.retry'))),
        ])
      }

      const empty = state === null || state.text === ''

      // `openable` gates the control, not just the request: this tab is a
      // singleton that is re-navigated in place, so a trash entry can follow a
      // worktree file in the same component — and the list it fetched for the
      // file would otherwise keep offering to open something that is not there.
      const current =
        !openable || openers === null ? null : (openers.list.find((row) => row.id === openers.last) ?? openers.list[0])

      return h('div', { className: 'lite-git-root', 'data-lite-git-diff': 'ready', style: { position: 'relative' } }, [
        // Clicking anywhere else closes the menu. A transparent scrim rather than
        // a document listener: the panel already unmounts this on every navigation,
        // and a listener is the thing that outlives the render that added it.
        menuOpen ? h('div', { key: 'scrim', className: 'lite-git-menuScrim', onClick: () => setMenuOpen(false) }) : null,
        h('div', { key: 'head', className: 'lite-git-head' }, [
          h('div', { key: 'ident', className: 'lite-git-ident' }, [
            h(
              'span',
              { key: 'name', className: 'lite-git-repo', title: target?.path ?? '' },
              target === null ? t('diff.title') : target.source === 'trash' ? t('diff.trashEntry') : splitPath(target.path).name,
            ),
            target === null || target.source === 'trash' ? null : h('span', { key: 'dir', className: 'lite-git-branch' }, splitPath(target.path).dir),
          ]),
          h('div', { key: 'tools', className: 'lite-git-tools' }, [
            // The open-with pair, in the corner the eye already visits. A trash
            // entry has no file to open, so the pair simply is not there — a
            // disabled button would invite a click that can never work.
            current === null
              ? null
              : h('span', { key: 'open', className: 'lite-git-openWrap' }, [
                  h(
                    IconButton,
                    {
                      key: 'go',
                      label: t('open.action', { app: openerName(t, current) }),
                      attrs: { 'data-lite-git-open': current.id },
                      onClick: () => void openWith(current.id),
                    },
                    h(OpenGlyph, {}),
                  ),
                  h(
                    IconButton,
                    {
                      key: 'choose',
                      label: t('open.choose'),
                      className: 'lite-git-caretBtn',
                      attrs: { 'data-lite-git-openmenu': menuOpen ? 'open' : 'closed' },
                      onClick: () => setMenuOpen((was) => !was),
                    },
                    h(ChevronDownGlyph, {}),
                  ),
                  menuOpen
                    ? h(
                        'div',
                        { key: 'menu', className: 'lite-git-menu', role: 'menu', 'data-lite-git-menu': '' },
                        openers.list.map((row) =>
                          h(
                            'button',
                            {
                              key: row.id,
                              type: 'button',
                              role: 'menuitemradio',
                              'aria-checked': row.id === current.id ? 'true' : 'false',
                              className: 'lite-git-menuItem',
                              'data-lite-git-opener': row.id,
                              onClick: () => void openWith(row.id),
                            },
                            [
                              row.id === current.id ? h(CheckGlyph, { key: 'mark' }) : h('span', { key: 'mark', style: { display: 'inline-block', width: 12, flex: 'none' } }),
                              h('span', { key: 'label', className: 'lite-git-menuLabel' }, openerName(t, row)),
                            ],
                          ),
                        ),
                      )
                    : null,
                ]),
            h(
              'span',
              { key: 'stats', className: 'lite-git-stats', style: { marginRight: 4 } },
              [
                (state?.added ?? 0) > 0 ? h('span', { key: 'p', className: 'lite-git-plus' }, `+${state.added}`) : null,
                (state?.deleted ?? 0) > 0 ? h('span', { key: 'm', className: 'lite-git-minus' }, `−${state.deleted}`) : null,
              ],
            ),
            // "Hide whitespace changes", as an icon rather than a labelled chip:
            // the header already carries several controls, and a word-shaped
            // button there competes with the file name. The tooltip carries the
            // sentence; the pressed state is what the colour says.
            openable
              ? h(
                  'button',
                  {
                    key: 'ws',
                    type: 'button',
                    className: `lite-git-iconBtn lite-git-wsBtn${ignoreWhitespace ? ' lite-git-wsBtn-on' : ''}`,
                    'data-lite-git-whitespace': ignoreWhitespace ? 'on' : 'off',
                    'aria-pressed': ignoreWhitespace ? 'true' : 'false',
                    title: `${t('diff.hideWhitespace')}（-w）`,
                    'aria-label': t('diff.hideWhitespace'),
                    onClick: () => setIgnoreWhitespace((was) => !was),
                  },
                  h(WhitespaceGlyph, { strokeWidth: 1.4 }),
                )
              : null,
            h(IconButton, { key: 'refresh', label: t('action.refresh'), onClick: () => void load() }, h(RefreshGlyph, {})),
          ]),
        ]),

        state?.truncated === true ? h(Banner, { key: 'trunc', tone: 'warn', text: t('diff.truncated') }) : null,
        state?.binary === true ? h(Banner, { key: 'bin', tone: 'warn', text: t('diff.binary') }) : null,
        // What the last press did. Worth a line here in a way an in-app click is
        // not: the program opens on the *host*, so on a remote client nothing at
        // all would appear to have happened.
        notice === null
          ? null
          : h(Banner, {
              key: 'notice',
              tone: notice.tone,
              text: notice.text,
              onClose: () => setNotice(null),
              closeLabel: t('action.cancel'),
            }),

        empty
          ? h('div', { key: 'empty', className: 'lite-git-empty' }, t('diff.empty'))
          : h(
              'div',
              { key: 'body', className: 'lite-git-diff', 'data-lite-git-diffbody': '' },
              renderDiffRows(rows, fileTotals, rawOpen, setRawOpen, t, {
                gapState: (from) => (expanded === null ? undefined : expanded[`${from}`]),
                gapLines: (from) => (gapText === null ? undefined : gapText[`${from}`]),
                onGap: (gap) => void expandGap(gap),
              }),
            ),
      ])
    }

    /**
     * The badge a file header wears, and the mark it leads with.
     *
     * `kind` is the same word the file list uses for its status glyph, so one
     * change looks the same in both places.
     */
    function fileBadgeKey(badge) {
      if (badge === 'added') return 'diff.headerAdd'
      if (badge === 'deleted') return 'diff.headerDelete'
      if (badge === 'renamed') return 'diff.headerRename'
      if (badge === 'binary') return 'diff.headerBinary'
      if (badge === 'mode') return 'diff.headerMode'
      return null
    }

    /** The icon kind a file header draws, from its badge. */
    function fileBadgeKind(badge) {
      if (badge === 'added') return 'added'
      if (badge === 'deleted') return 'deleted'
      if (badge === 'renamed') return 'renamed'
      if (badge === 'binary') return 'modified'
      return 'modified'
    }

    /**
     * One file header card: which file, what happened to it, how much moved, and
     * a disclosure for the mechanical lines the card replaced.
     *
     * The raw lines are *offered*, never dropped: this tab is the only reading of
     * a discarded change once `git restore` has run, and a renderer that silently
     * discarded the `index` line would be hiding the one thing that says which
     * blob was compared.
     */
    function FileHeader({ row, index, totals, open, onToggle, t }) {
      const parts = splitPath(row.path)
      const dir = parts.dir.endsWith('/') ? parts.dir.slice(0, -1) : parts.dir
      const Mark = statusGlyph(fileBadgeKind(row.badge))
      const badgeKey = fileBadgeKey(row.badge)
      const raw = Array.isArray(row.raw) ? row.raw : []

      return h('div', { key: `f${index}`, className: 'lite-git-fileHead', 'data-lite-git-filehead': row.path }, [
        h('span', { key: 'icon', className: `lite-git-fileIcon lite-git-status-${fileBadgeKind(row.badge)}` }, h(Mark, { size: 13 })),
        h('span', { key: 'path', className: 'lite-git-filePath', title: row.origPath === undefined ? row.path : `${row.origPath} → ${row.path}` }, [
          dir === '' ? null : h('span', { key: 'dir', className: 'lite-git-fileDir' }, h('span', { key: 't', className: 'lite-git-fileDirText' }, dir)),
          dir === '' ? null : h('span', { key: 'sep', className: 'lite-git-sep' }, '/'),
          h('span', { key: 'name', className: 'lite-git-fileName' }, parts.name),
        ]),
        row.origPath === undefined
          ? null
          : h('span', { key: 'from', className: 'lite-git-fileFrom', title: row.origPath }, h('span', { key: 't', className: 'lite-git-fileFromText' }, row.origPath)),
        badgeKey === null ? null : h('span', { key: 'badge', className: 'lite-git-badge' }, t(badgeKey)),
        totals === undefined
          ? null
          : h('span', { key: 'stats', className: 'lite-git-fileStats' }, [
              totals.added > 0 ? h('span', { key: 'p', className: 'lite-git-plus' }, `+${totals.added}`) : null,
              totals.deleted > 0 ? h('span', { key: 'm', className: 'lite-git-minus' }, `−${totals.deleted}`) : null,
            ]),
        raw.length === 0
          ? null
          : h(
              'button',
              {
                key: 'raw',
                type: 'button',
                className: `lite-git-rawToggle${open ? ' lite-git-rawToggle-open' : ''}`,
                'data-lite-git-rawtoggle': row.path,
                'aria-expanded': open ? 'true' : 'false',
                title: open ? t('diff.headerHide') : t('diff.headerShow'),
                'aria-label': open ? t('diff.headerHide') : t('diff.headerShow'),
                onClick: () => onToggle(index),
              },
              h(ChevronRightGlyph, { size: 12 }),
            ),
      ])
    }

    /**
     * Pair the removed lines of a hunk with the added lines that replaced them.
     *
     * GitHub Desktop's diff view colours the whole row, then re-colours the few
     * characters that actually differ — "let total = a - b" → "let total = a + b"
     * marks the `-`/`+` and nothing else. That needs to know which removed line
     * became which added line, which git's unified format does *not* say: it only
     * groups the runs.
     *
     * The pairing is by position within a run, which is what the visual form
     * implies: a hunk that removes three lines and adds three is shown as three
     * rows, and the reader naturally compares them one for one. A run that
     * removed two and added five pairs the first two and leaves the rest
     * unpaired, so their whole row stays strongly coloured — which is also the
     * honest reading: the remaining three have no counterpart.
     *
     * @param {object[]} rows what `diffRows` returned, in order
     * @returns {Map<number, number>} row index → the index of its counterpart
     */
    function pairChangedRows(rows) {
      const pairs = new Map()
      let index = 0
      while (index < rows.length) {
        if (rows[index].kind !== 'del') {
          index += 1
          continue
        }
        // The whole removed run, then the whole added run that follows it.
        const dels = []
        while (index < rows.length && rows[index].kind === 'del') {
          dels.push(index)
          index += 1
        }
        const adds = []
        while (index < rows.length && rows[index].kind === 'add') {
          adds.push(index)
          index += 1
        }
        const count = Math.min(dels.length, adds.length)
        for (let i = 0; i < count; i += 1) {
          pairs.set(dels[i], adds[i])
          pairs.set(adds[i], dels[i])
        }
      }
      return pairs
    }

    /**
     * The spans of `text` that actually changed, given the text it became.
     *
     * A longest-common-subsequence over *characters*, reported as ranges rather
     * than as an edit script: all the renderer needs is "these characters are the
     * same, those are not". Anything longer than one line is compared code-point
     * by code-point, which is what GitHub Desktop's word-level mode degrades to
     * for short rewrites — and a word-level split would mark a whole identifier
     * changed because one letter moved.
     *
     * The cost is O(n·m) in the line's length, which is bounded here on purpose:
     * the panel's diff already caps the bytes it will render, and a single line
     * long enough to make this slow is a minified bundle, where a character diff
     * has nothing useful to say anyway. Those lines are skipped by length.
     *
     * @param {string} before
     * @param {string} after
     * @returns {{ before: [number, number][], after: [number, number][] }} half-open ranges
     */
    function changedSpans(before, after) {
      const MAX = 2000
      if (before.length > MAX || after.length > MAX) return { before: [], after: [] }
      const a = Array.from(before)
      const b = Array.from(after)
      const n = a.length
      const m = b.length

      // `common[i][j]` is the LCS length of a[i..] and b[j..]. A full table is
      // fine at this size and much simpler to get right than a rolling row.
      const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
        }
      }

      const spans = { before: [], after: [] }
      let i = 0
      let j = 0
      const push = (list, index) => {
        const last = list[list.length - 1]
        if (last !== undefined && last[1] === index) last[1] = index + 1
        else list.push([index, index + 1])
      }
      while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) {
          i += 1
          j += 1
          continue
        }
        // Walk the changed region: consume from whichever side the table says has
        // a better remainder, until the two meet again on a shared character.
        if (j < m && (i >= n || common[i][j + 1] >= common[i + 1][j])) {
          push(spans.after, j)
          j += 1
        } else if (i < n) {
          push(spans.before, i)
          i += 1
        }
      }
      return spans
    }

    /**
     * A line's text, split into plain runs and highlighted ones.
     *
     * @param {string} text the whole line, without its sign
     * @param {[number, number][]} spans half-open code-point ranges
     * @returns {(string | { text: string, at: number })[]}
     */
    function splitBySpans(text, spans) {
      if (spans === undefined || spans.length === 0) return [text]
      const chars = Array.from(text)
      const out = []
      let cursor = 0
      for (const [from, to] of spans) {
        if (from > cursor) out.push(chars.slice(cursor, from).join(''))
        out.push({ text: chars.slice(from, to).join(''), at: from })
        cursor = to
      }
      if (cursor < chars.length) out.push(chars.slice(cursor).join(''))
      return out
    }

    /**
     * The gaps a diff left out, one entry per run of unchanged lines between hunks.
     *
     * git prints a hunk plus some context around it and nothing about what lies
     * between two hunks beyond the `@@` coordinates — but those coordinates are
     * enough: the old-side line where the next hunk starts, minus the old-side
     * line where the previous one ended, is the number of lines that were
     * skipped. That is exactly what "expand the context" has to ask for, and
     * asking per gap is what lets one hunk be expanded while the others stay
     * folded (a `-U<n>` re-diff would widen all of them).
     *
     * @param {{ kind: string, oldLine?: number, text?: string }[]} rows
     * @returns {{ from: number, to: number, after: number, before: number }[]}
     *   `from`/`to` are 1-based old-side lines, inclusive; `after`/`before` are
     *   the row indices the gap sits between, for the renderer to place it.
     */
    function diffGaps(rows) {
      const gaps = []
      let previous = null
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        // A new file starts a new numbering: the gap between two files is not a
        // region of either one, and carrying `previous` across the boundary
        // produced a strip claiming to open the first lines of the second file.
        if (row.kind === 'file') {
          previous = null
          continue
        }
        if (row.kind !== 'hunk') continue
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row.text ?? '')
        if (match === null) continue
        const oldStart = Number(match[1])
        const oldCount = match[2] === undefined ? 1 : Number(match[2])
        if (previous !== null) {
          const from = previous.end + 1
          const to = oldStart - 1
          if (to >= from) gaps.push({ from, to, after: previous.index, before: index })
        }
        previous = { end: oldStart + oldCount - 1, index }
      }
      return gaps
    }

    /**
     * The strip that stands in for the lines a diff left out.
     *
     * One row, two buttons at its left end, and the count as the text between
     * them. The two buttons are not redundant: a gap has an upper and a lower
     * edge, and "show me the lines just above this hunk" is a different request
     * from "show me the lines just below that one". Each press pulls in 20 lines
     * from its own edge — GitHub's own limit for a context request, and the
     * reason this arrives in pieces.
     *
     * The thinking is GitHub Desktop's: the arrows sit where the line numbers do
     * and the text sits where the code does, so the control is a row of the diff
     * rather than a band across it.
     *
     * @param {object} input
     * @param {{ from: number, to: number }} input.gap
     * @param {{ down: number, up: number }} input.state lines already pulled in
     * @param {number} input.total
     * @param {number} input.remaining
     * @param {object} input.expansion
     * @param {(key: string, params?: object) => string} input.t
     */
    function renderGapStrip({ gap, state, total, remaining, expansion, t }) {
      // At least one edge always has room here — the strip is not drawn once the
      // gap is full — but one of them can have reached the other, and a button
      // that cannot do anything must say so rather than silently doing nothing.
      const canDown = state.down < total - state.up
      const canUp = state.up < total - state.down
      const label = remaining === total ? t('diff.gapHidden', { n: total }) : t('diff.gapRemaining', { n: remaining })
      const press = (edge) => () => expansion.onGap({ ...gap, edge })

      return h(
        'div',
        {
          key: `g${gap.from}`,
          className: 'lite-git-diffRow lite-git-gapRow',
          'data-lite-git-gap': `${gap.from}-${gap.to}`,
          'data-lite-git-gap-down': String(state.down),
          'data-lite-git-gap-up': String(state.up),
        },
        [
          // Both buttons in the gutter's column, side by side, so the row lines
          // up with the code below it and the control reads as part of the diff.
          h('span', { key: 'g', className: 'lite-git-gapButtons' }, [
            h(
              'button',
              {
                key: 'down',
                type: 'button',
                className: 'lite-git-gapBtn',
                'data-lite-git-gapbtn': 'down',
                disabled: !canDown,
                title: t('diff.gapDown', { n: Math.min(GAP_STEP, total - state.up - state.down) }),
                'aria-label': t('diff.gapDown', { n: Math.min(GAP_STEP, total - state.up - state.down) }),
                onClick: press('down'),
              },
              h(ChevronDownGlyph, { size: 12 }),
            ),
            h(
              'button',
              {
                key: 'up',
                type: 'button',
                className: 'lite-git-gapBtn',
                'data-lite-git-gapbtn': 'up',
                disabled: !canUp,
                title: t('diff.gapUp', { n: Math.min(GAP_STEP, total - state.up - state.down) }),
                'aria-label': t('diff.gapUp', { n: Math.min(GAP_STEP, total - state.up - state.down) }),
                onClick: press('up'),
              },
              h(ChevronUpGlyph, { size: 12 }),
            ),
          ]),
          h('span', { key: 'c', className: 'lite-git-code lite-git-gapText' }, label),
        ],
      )
    }

    /**
     * Every row of a diff, the way the tab draws it.
     *
     * Kept beside `diffRows` rather than inline in `DiffBody` so the shape can be
     * asserted without a DOM: this is the half of the renderer whose *content*
     * matters (which row is a header, which is a line, what the gutter says), and
     * the shell around it is the part the seat tests already cover.
     *
     * @param {object[]} rows what `diffRows` returned
     * @param {Map<number, {added: number, deleted: number}>} fileTotals per file index
     * @param {number | null} rawOpen the file index whose raw lines are showing
     * @param {(index: number) => void} onToggleRaw
     * @param {(key: string) => string} t
     * @param {{ gapState?: (from: number) => { down: number, up: number } | undefined, gapLines?: (from: number) => Record<number, string> | undefined, onGap?: (gap: object) => void }} [expansion]
     *   the context-expansion state. Absent means every gap stays folded, which is
     *   what the tests and the trash view want.
     */
    function renderDiffRows(rows, fileTotals, rawOpen, onToggleRaw, t, expansion) {
      const out = []
      const pairs = pairChangedRows(rows)
      const gaps = diffGaps(rows)
      const gapByRow = new Map()
      for (const gap of gaps) gapByRow.set(gap.before, gap)
      let fileIndex = -1
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const key = `${index}`

        if (row.kind === 'file') {
          fileIndex += 1
          const open = rawOpen === fileIndex
          out.push(
            h(FileHeader, {
              key: `h${key}`,
              row,
              index: fileIndex,
              totals: fileTotals.get(fileIndex),
              open,
              onToggle: onToggleRaw,
              t,
            }),
          )
          if (open) {
            for (const line of row.raw ?? []) {
              out.push(h('div', { key: `r${key}-${out.length}`, className: 'lite-git-raw', 'data-lite-git-raw': line }, line))
            }
          }
          continue
        }

        if (row.kind === 'hunk') {
          // The gap above this hunk, if there is one.
          //
          // The order matters and was wrong at first: the strip stands for *the
          // part that is still hidden*, so it belongs between the two edges —
          // the lines pulled down from the hunk above come first, then the strip,
          // then the lines pulled up from the hunk below. Drawing the strip once,
          // before everything, left it pinned to the top of the gap while the
          // lines it was supposed to be standing in for appeared underneath it.
          //
          // And when nothing is left hidden the strip is not drawn at all: a row
          // offering to show 0 more lines is a control that cannot do anything.
          const gap = gapByRow.get(index)
          const expandable = gap !== undefined && expansion !== undefined && typeof expansion.onGap === 'function'
          let stripDrawn = false
          if (expandable) {
            const state = typeof expansion.gapState === 'function' ? (expansion.gapState(gap.from) ?? { down: 0, up: 0 }) : { down: 0, up: 0 }
            const total = gap.to - gap.from + 1
            const shown = Math.min(total, state.down + state.up)
            const remaining = total - shown
            const lines = typeof expansion.gapLines === 'function' ? (expansion.gapLines(gap.from) ?? {}) : {}
            const pushLine = (lineNo) => {
              const text = lines[lineNo]
              out.push(
                h('div', { key: `g${gap.from}-${lineNo}`, className: 'lite-git-diffRow lite-git-r-ctx' }, [
                  h('span', { key: 'gu', className: 'lite-git-gutter' }, [
                    h('span', { key: 'a' }, String(lineNo)),
                    h('span', { key: 'b' }, String(lineNo)),
                    h('span', { key: 's', className: 'lite-git-sign' }, ''),
                  ]),
                  h('span', { key: 'c', className: 'lite-git-code' }, text === '' || text === undefined ? '​' : text),
                ]),
              )
            }

            // Top edge first, downwards from the hunk above.
            for (let i = 0; i < state.down; i += 1) pushLine(gap.from + i)
            // Then the strip, for whatever is still hidden.
            if (remaining > 0) {
              out.push(renderGapStrip({ gap, state, total, remaining, expansion, t }))
              stripDrawn = true
            }
            // Then the bottom edge, upwards from the hunk below.
            for (let i = state.up; i > 0; i -= 1) pushLine(gap.to - i + 1)
          }
          // A hunk header is a marker between regions, not a line of the file:
          // its `@@ -1,2 +1,3 @@` is a coordinate, and printing it above the
          // code only invites reading it as source. The section heading — what
          // git copies out of the enclosing function — is the one part of it a
          // reader can use, so that is what survives.
          //
          // Three cases, and the rule is "the row exists only while there is
          // something it is standing in for":
          //
          //   * no gap at all — this is the start of the diff, so the row says
          //     where the file picks up (`⋯` when it has no section text);
          //   * a gap with lines still hidden — the strip is the row, and adding
          //     an ellipsis row beside it put two rows on one fact;
          //   * a gap fully expanded — the content is continuous now, so there is
          //     nothing to mark: no strip, and no ellipsis either. Leaving one
          //     put a stray `⋯` line in the middle of what should read as an
          //     unbroken file.
          const hasSection = typeof row.section === 'string' && row.section !== ''
          if (expandable) continue
          out.push(
            h('div', { key, className: 'lite-git-diffRow lite-git-r-hunk', 'data-lite-git-hunk': row.text }, [
              h('span', { key: 'g', className: 'lite-git-gutter' }, [h('span', { key: 'a' }, ''), h('span', { key: 'b' }, '')]),
              hasSection
                ? h('span', { key: 'c', className: 'lite-git-code lite-git-hunkSection' }, row.section)
                : h('span', { key: 'c', className: 'lite-git-code' }, '⋯'),
            ]),
          )
          continue
        }

        if (row.kind === 'meta' || row.kind === 'note') {
          out.push(
            h('div', { key, className: `lite-git-diffRow lite-git-r-${row.kind}` }, [
              h('span', { key: 'g', className: 'lite-git-gutter' }, [h('span', { key: 'a' }, ''), h('span', { key: 'b' }, '')]),
              h('span', { key: 'c', className: 'lite-git-code' }, row.text),
            ]),
          )
          continue
        }

        // A line of the file. The `+`/`-` lives in its own narrow column, in the
        // gutter, and the code column holds exactly what the line says — so a
        // `+` that belongs to the source is still a `+`, and an added line is
        // recognisable from its colour and its number rather than from a
        // character glued to the front of the text.
        //
        // Within a paired del/add the row already carries the strong colour; the
        // characters that actually changed get a stronger one, which is what makes
        // `a - b` → `a + b` readable at a glance instead of as two coloured rows.
        const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''
        const other = pairs.get(index)
        const counterpart = other === undefined ? undefined : rows[other]
        const spans =
          counterpart === undefined
            ? undefined
            : row.kind === 'del'
              ? changedSpans(row.text, counterpart.text).before
              : changedSpans(counterpart.text, row.text).after
        const code =
          spans === undefined || spans.length === 0
            ? row.text === '' ? '​' : row.text
            : splitBySpans(row.text, spans).map((part, partIndex) =>
                typeof part === 'string'
                  ? part
                  : h('span', { key: `s${partIndex}`, className: 'lite-git-codeChanged' }, part.text),
              )
        out.push(
          h('div', { key, className: `lite-git-diffRow lite-git-r-${row.kind}` }, [
            h('span', { key: 'g', className: 'lite-git-gutter' }, [
              h('span', { key: 'a' }, row.kind === 'add' ? '' : String(row.oldLine ?? '')),
              h('span', { key: 'b' }, row.kind === 'del' ? '' : String(row.newLine ?? '')),
              h('span', { key: 's', className: 'lite-git-sign' }, sign),
            ]),
            h('span', { key: 'c', className: 'lite-git-code' }, code),
            typeof row.noNewline === 'string'
              ? h('span', { key: 'n', className: 'lite-git-noEol', title: t('diff.noNewline') }, '⏎̸')
              : null,
          ]),
        )
      }
      return out
    }

    /* ------------------------------------------------------------------ *
     * 11. Tab titles
     * ------------------------------------------------------------------ */

    /** The panel's chip: the branch mark plus the panel name. */
    function GitTitle(props) {
      const t = props.t ?? fallbackTranslate()
      return h('span', { className: 'lite-git-tabTitle' }, [
        h(GitGlyph, { key: 'g', size: 14 }),
        h('span', { key: 'l', className: 'lite-git-tabTitleText' }, t('panel.title')),
      ])
    }

    /** The trash chip. */
    function TrashTitle(props) {
      const t = props.t ?? fallbackTranslate()
      return h('span', { className: 'lite-git-tabTitle' }, [
        h(TrashGlyph, { key: 'g', size: 14 }),
        h('span', { key: 'l', className: 'lite-git-tabTitleText' }, t('trash.title')),
      ])
    }

    /**
     * The diff chip.
     *
     * Registered as a seat rather than left to the definition's `title(address)`
     * on purpose: a captured title never changes, and this tab is re-navigated
     * in place — so it has to read the live `navigation.params` to name the file
     * currently on screen.
     */
    function DiffTitle(props) {
      const t = props.t ?? fallbackTranslate()
      const tab = props.useTabInfo().tab
      const target = diffTarget(tab.navigation?.params)
      const label =
        target === null
          ? t('diff.title')
          : target.source === 'trash'
            ? t('diff.trashEntry')
            : splitPath(target.path).name
      return h('span', { className: 'lite-git-tabTitle' }, [
        h(ChevronRightGlyph, { key: 'g', size: 14 }),
        h('span', { key: 'l', className: 'lite-git-tabTitleText' }, label),
      ])
    }

    /* ------------------------------------------------------------------ *
     * 11a. The toolbar icon
     * ------------------------------------------------------------------ */

    /**
     * The icon in the conversation's top-right toolbar, left of the ⋯ menu.
     *
     * This is the one control the plugin puts anywhere outside the right column,
     * and it exists for a specific reason: the Git panel lives in a tab the user
     * has to find, and a change that nobody looks at is a change nobody commits.
     * The icon carries the count, so "there are three files waiting" is readable
     * from the conversation without opening anything, and pressing it opens the
     * panel where the list is.
     *
     * It reads the count from the same `status` action the panel does, on its own
     * schedule, because the seat mounts even when the panel was never opened. Two
     * rules keep that from being wasteful: the read is skipped when the session
     * has no repository bound (the host answers `E_NO_REPO`, and a failed request
     * per mount is noise), and a focus re-read is debounced the same way the
     * panel's own is.
     */
    function HeaderIcon(props) {
      const t = props.t ?? fallbackTranslate()
      const ctx = props.ctx
      const sessionId = props.sessionId
      const [count, setCount] = useState(null)
      const [busy, setBusy] = useState(false)
      // The tab the panel is already in, if the session has one: pressing a
      // second time should *show* it, not stack a duplicate.
      const open = useCallback(() => {
        if (ctx === undefined || typeof ctx.sidebarRight?.openTabIn !== 'function') return
        ctx.sidebarRight.openTabIn(sessionId, GIT_KIND)
      }, [ctx, sessionId])

      const read = useCallback(async () => {
        if (sessionId === undefined || sessionId === null) return
        try {
          const data = await rpc(ACTIONS.STATUS, { sessionId }, undefined)
          setCount(data.repoRoot === null || data.repoRoot === undefined ? 0 : (data.files ?? []).length)
        } catch {
          // Not bound, no git, no workspace: all of them mean "there is nothing
          // to show a count of", which is what the empty state says too.
          setCount(null)
        }
      }, [sessionId])

      useEffect(() => {
        void read()
      }, [read])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        let timer = null
        const onFocus = () => {
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            void read()
          }, 150)
        }
        window.addEventListener('focus', onFocus)
        return () => {
          if (timer !== null) clearTimeout(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [read])

      const label = count === null || count === 0 ? t('panel.open') : `${t('panel.open')} · ${t('panel.changes', { n: count })}`

      return h(
        'button',
        {
          type: 'button',
          className: `lite-git-headerIcon${count !== null && count > 0 ? ' lite-git-headerIcon-active' : ''}`,
          'data-lite-git-headericon': count === null ? '' : String(count),
          title: label,
          'aria-label': label,
          disabled: busy === true,
          onClick: () => {
            setBusy(true)
            // The press is answered by the tab appearing, which is the next
            // frame's work; the flag only stops a double press from queueing a
            // second open in the same gesture.
            setTimeout(() => setBusy(false), 250)
            open()
          },
        },
        h(GitGlyph, { size: 15 }),
        count !== null && count > 0
          ? h('span', { key: 'n', className: 'lite-git-headerBadge', 'aria-hidden': 'true' }, count > 99 ? '99+' : String(count))
          : null,
      )
    }

    /* ------------------------------------------------------------------ *
     * 12. Install
     * ------------------------------------------------------------------ */

    /**
     * @param {object} ctx client context
     */
    function apply(ctx) {
      ensureStyle()

      // The dictionaries go to the locale service when there is one; the inline
      // table is the fallback for a composition without it.
      const locale = ctx.locale
      if (locale !== undefined && typeof locale.register === 'function') {
        ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'dsh-lite-git: copy')
      }
      const t = locale !== undefined && typeof locale.bind === 'function' ? locale.bind(NS) : fallbackTranslate()

      /**
       * Inject the context plus a bound translator into every body, and the
       * session id when the seat has one.
       *
       * `ctx` is handed over explicitly because a slot's standard props carry no
       * context — the same reason the shipped settings row does it.
       */
      const injectFor = () => ({ ctx, t })

      /* --- the panel ----------------------------------------------------- */

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: GIT_ID,
            kind: GIT_KIND,
            title: () => t('panel.title'),
            // The panel keeps its ticks and its half-written Summary while the
            // user peeks at a diff in the next tab along.
            keepMounted: true,
            guide: [
              {
                id: 'changes',
                order: GUIDE_ORDER,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
                icon: GuideGlyph,
              },
            ],
          }),
        'dsh-lite-git: panel type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: GIT_ID,
                locale: NS,
                inject: (sessionId) => injectFor(sessionId),
              },
              GitBody,
            ),
          ),
        'dsh-lite-git: panel body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: GIT_ID, locale: NS, inject: () => ({ t }) },
              GitTitle,
            ),
          ),
        'dsh-lite-git: panel title',
      )

      /* --- the trash ----------------------------------------------------- */

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TRASH_ID,
            kind: TRASH_KIND,
            title: () => t('trash.title'),
          }),
        'dsh-lite-git: trash type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TRASH_ID,
                locale: NS,
                inject: (sessionId) => injectFor(sessionId),
              },
              TrashBody,
            ),
          ),
        'dsh-lite-git: trash body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: TRASH_ID, locale: NS, inject: () => ({ t }) },
              TrashTitle,
            ),
          ),
        'dsh-lite-git: trash title',
      )

      /* --- the diff tab, a singleton by address -------------------------- */

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: DIFF_ID,
            kind: DIFF_KIND,
            patterns: [DIFF_PATTERN],
            canOpen: (address) => address === DIFF_ADDRESS || address.startsWith(`${DIFF_ADDRESS}/`),
            // Never seen: the live chip comes from the title seat below.
            title: () => t('diff.title'),
          }),
        'dsh-lite-git: diff type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: DIFF_ID,
                locale: NS,
                inject: (sessionId) => injectFor(sessionId),
              },
              DiffBody,
            ),
          ),
        'dsh-lite-git: diff body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: DIFF_ID, locale: NS, inject: () => ({ t }) },
              DiffTitle,
            ),
          ),
        'dsh-lite-git: diff title',
      )

      /* --- the conversation header's toolbar ------------------------------ */

      // The icon beside the ⋯ menu. Its own id, its own order: the shipped
      // schedule button sits at -5 and the overflow menu at 0, so a positive
      // order puts this one immediately left of the menu, which is where the
      // user asked for it.
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: HEADER_ICON_ID,
                order: 10,
                locale: NS,
                inject: () => ({ ctx, t }),
              },
              HeaderIcon,
            ),
          ),
        'dsh-lite-git: header icon',
      )
    }

    exports.name = PLUGIN_ID
    // Every one of these is a shipped service of the Web app; without any of
    // them there is no right column to put a tab in.
    exports.inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']
    exports.apply = apply

    /**
     * Internals the test suite drives directly.
     *
     * The pure helpers are exported rather than duplicated in the tests, so a
     * change to the diff renderer cannot pass a stale expectation.
     */
    exports.internals = {
      RPC_ROUTE,
      ACTIONS,
      NS,
      GIT_ID,
      GIT_KIND,
      TRASH_ID,
      TRASH_KIND,
      DIFF_ID,
      DIFF_KIND,
      DIFF_ADDRESS,
      DIFF_PATTERN,
      ZH,
      EN,
      diffRows,
      diffGaps,
      pairChangedRows,
      changedSpans,
      splitBySpans,
      renderDiffRows,
      fileBadgeKey,
      FileHeader,
      HeaderIcon,
      HEADER_ICON_ID,
      statusKind,
      statusGlyph,
      splitPath,
      formatRelative,
      lastFetchLabel,
      restoreReasonText,
      splitScriptOutput,
      stagedCount,
      selectablePaths,
      selectionState,
      hasConflict,
      contextLabelKey,
      contextAction,
      busyLabel,
      diffTarget,
      commitReadiness,
      interpolate,
      errorText,
      openerName,
      // The pieces with no hooks in them, so the suite can assert what they
      // render without a DOM: a tick's state, the confirmation's default, and
      // the picker's candidates are all pure functions of their props.
      ChangeRow,
      DiscardDialog,
      RepositoryPicker,
      Banner,
    }

    return module.exports
  },
})
