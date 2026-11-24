/**
 * "Looked at again": the panel re-reads the list and lets the script fill the
 * Summary — on open, on return, and never at the cost of what the user typed.
 * A re-read also decides which files look newly arrived and tick them, so this
 * file covers that rule too: what a refresh ticks, and what it must not.
 *
 * Why this file exists
 * -------------------
 * This behaviour shipped twice without working. The first version keyed on
 * `tabInfo.tab.visible`, which in this shell stays true for as long as the
 * sidebar is expanded and the tab is its pane's active tab — so "the user came
 * back to the panel" was invisible to it. The second version listened for the
 * right events but asked *this render's closure* whether a script existed, and
 * that closure is from before the read that was just awaited — so on the panel's
 * first open it answered "no script" and never filled anything.
 *
 * Neither failure is visible to the stub-based suites, which do not run effects.
 * So this file runs the real bundle against a small but real React: state,
 * effects with dependency comparison, callbacks, refs. It is not a DOM test and
 * does not try to be one; it asserts on the calls the panel made and on the
 * values it rendered.
 *
 * @module dsh-lite-git/test/focus
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// --------------------------------------------------------------- tiny React

const Fragment = Symbol('Fragment')

function createRuntime() {
  const instances = new Map()
  let currentKey = null
  let hookIndex = 0
  let effects = []
  let dirty = false
  let elements = []
  let root = null

  const sameDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

  const hooksOf = () => {
    let instance = instances.get(currentKey)
    if (instance === undefined) {
      instance = { hooks: [] }
      instances.set(currentKey, instance)
    }
    return instance.hooks
  }

  const React = {
    Fragment,
    createElement(type, props, ...children) {
      const own = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: props === null ? {} : props, children: own }
    },
    useState(fallback) {
      const hooks = hooksOf()
      const index = hookIndex++
      if (hooks[index] === undefined) {
        hooks[index] = { kind: 'state', value: typeof fallback === 'function' ? fallback() : fallback }
      }
      const slot = hooks[index]
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (!Object.is(value, slot.value)) {
            slot.value = value
            dirty = true
          }
        },
      ]
    },
    useRef(initial) {
      const hooks = hooksOf()
      const index = hookIndex++
      if (hooks[index] === undefined) hooks[index] = { kind: 'ref', current: initial }
      return hooks[index]
    },
    useEffect(fn, deps) {
      const hooks = hooksOf()
      const index = hookIndex++
      if (hooks[index] === undefined) hooks[index] = { kind: 'effect', deps: undefined, cleanup: undefined }
      effects.push({ key: currentKey, index, fn, deps })
    },
    useCallback(fn, deps) {
      const hooks = hooksOf()
      const index = hookIndex++
      const slot = hooks[index]
      if (slot === undefined || slot.kind !== 'memo' || !sameDeps(slot.deps, deps)) {
        hooks[index] = { kind: 'memo', deps, value: fn }
      }
      return hooks[index].value
    },
    useMemo(fn, deps) {
      const hooks = hooksOf()
      const index = hookIndex++
      const slot = hooks[index]
      if (slot === undefined || slot.kind !== 'memo' || !sameDeps(slot.deps, deps)) {
        hooks[index] = { kind: 'memo', deps, value: fn() }
      }
      return hooks[index].value
    },
  }

  const renderNode = (node, path) => {
    if (node === null || node === undefined || node === true || node === false) return null
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}/${index}`))
    if (typeof node !== 'object') return { kind: 'text', text: String(node) }
    if (node.type === Fragment) return renderNode(node.children, path)
    if (typeof node.type === 'function') {
      const key = `${path}:${node.type.name || 'component'}`
      const parent = currentKey
      currentKey = key
      hookIndex = 0
      const rendered = node.type({ ...node.props, children: node.children })
      currentKey = parent
      return renderNode(rendered, `${key}#out`)
    }
    const host = { kind: 'host', type: node.type, props: node.props ?? {}, children: [] }
    elements.push(host)
    const kids = node.children === undefined ? [] : Array.isArray(node.children) ? node.children : [node.children]
    host.children = kids.map((child, index) => renderNode(child, `${path}/${index}`))
    return host
  }

  /** Render until nothing is pending: state updates and newly-run effects. */
  const pump = async (label = '') => {
    for (let round = 0; round < 80; round += 1) {
      dirty = false
      effects = []
      elements = []
      hookIndex = 0
      currentKey = null
      renderNode(root, 'root')

      let ran = 0
      for (const effect of effects) {
        const instance = instances.get(effect.key)
        const slot = instance?.hooks[effect.index]
        if (slot !== undefined && sameDeps(slot.deps, effect.deps)) continue
        if (typeof slot?.cleanup === 'function') slot.cleanup()
        const cleanup = effect.fn()
        instance.hooks[effect.index] = { kind: 'effect', deps: effect.deps, cleanup }
        ran += 1
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!dirty && ran === 0) return
    }
    throw new Error(`never settled${label === '' ? '' : ` (${label})`}`)
  }

  return {
    React,
    pump,
    elements: () => elements,
    /** A fresh mount: every hook instance is forgotten, as an unmount would. */
    remount(element) {
      instances.clear()
      root = element
    },
    async mount(element, label = '') {
      this.remount(element)
      await pump(label)
    },
  }
}

// ------------------------------------------------------------------ the panel

/**
 * Load the real bundle against a fake host and return a tiny driver.
 *
 * @param {{ script?: string, files?: Array<{ path: string, staged?: boolean, partial?: boolean, conflicted?: boolean, kind?: string }> }} [options]
 */
function createPanel(options = {}) {
  const runtime = createRuntime()
  const window = new EventTarget()
  const document = {
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  const calls = []
  const commits = []
  let stored = options.script ?? ''
  const statusFields = {
    workspacePath: 'C:/work',
    workspaceTitle: 'work',
    source: 'binding',
    repoRoot: 'C:/work/repo',
    repoName: 'repo',
    branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
    remotes: ['origin'],
    prefs: {},
    primary: 'fetch',
    lastFetchAt: null,
    autoFetchMs: 0,
  }

  // A working tree the test can move. `status` is answered from a real mutable
  // list, so a refresh after the tree changed is a genuine new payload rather than
  // a replayed one — which is what the "what is ticked after a refresh" rule is
  // about.
  const repo = {
    files: (options.files ?? []).map((file) => ({
      staged: false,
      partial: false,
      conflicted: false,
      kind: 'modified',
      ...file,
    })),
    /** The worktree changed: a new path shows up. */
    add(file) {
      this.files.push({ staged: false, partial: false, conflicted: false, kind: 'untracked', ...file })
    },
    /**
     * The worktree changed under a file that is already in the list.
     *
     * `staged`/`partial` describe the *index*, which the panel no longer reads for
     * its ticks — they are kept so the fixture still looks like real `git status`
     * output, and so a test can prove the panel ignores them. A path that is in
     * the index and changed again reads `MM`; one that was never added stays `.M`.
     */
    edit(path, stats = {}) {
      const file = this.files.find((candidate) => candidate.path === path)
      assert.notEqual(file, undefined, `the fixture has a file at ${path}`)
      Object.assign(file, stats)
    },
    ticked(path) {
      return this.files.find((file) => file.path === path)?.staged === true
    },
  }

  const snapshot = () => repo.files.map((file) => ({ ...file }))
  const tally = () => ({
    files: repo.files.length,
    conflicted: repo.files.filter((file) => file.conflicted === true).length,
  })
  const status = () => ({ ...statusFields, files: snapshot(), counts: tally(), summaryScript: stored })

  const answer = async (action, body) => {
    calls.push(action)
    if (action === 'status') return status()
    if (action === 'commit' || action === 'commitAndPush') {
      commits.push({ paths: [...(body.paths ?? [])], summary: body.summary })
      // A real commit removes the committed paths from the list.
      const wanted = new Set(body.paths ?? [])
      repo.files = repo.files.filter((file) => !wanted.has(file.path))
      return { commit: { short: 'abc1234' }, ...(action === 'commitAndPush' ? { push: { ok: true } } : {}) }
    }
    if (action === 'saveScript') {
      stored = body.script
      return { summaryScript: stored, script: stored }
    }
    if (action === 'runScript') return { ran: true, exitCode: 0, stdout: '1.4.2\n', stderr: '' }
    return {}
  }

  const fetchImpl = async (_path, init) => {
    const body = JSON.parse(init.body)
    return { status: 200, json: async () => ({ ok: true, ...(await answer(body.action, body)) }) }
  }

  let registered = null
  window.__ModuleLoader__ = { load: (spec) => (registered = spec) }
  new Function('window', 'document', 'navigator', 'globalThis', 'require', 'fetch', source)(
    window,
    document,
    { language: 'zh-CN' },
    globalThis,
    (id) => {
      if (id !== 'react') throw new Error(`unexpected require: ${id}`)
      return runtime.React
    },
    fetchImpl,
  )
  assert.notEqual(registered, null, 'the bundle registers itself')

  const bundle = registered.factory((id) => {
    if (id !== 'react') throw new Error(`unexpected require: ${id}`)
    return runtime.React
  })

  // The seats, registered the way the shell registers them.
  const seats = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    slots: {
      inject: (_name, factoryFn) => {
        const result = factoryFn()
        for (const seat of Array.isArray(result) ? result : [result]) seats.push({ ...seat })
        return () => {}
      },
      register: (definition, component) => {
        seats.push({ ...definition, component })
        return () => {}
      },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTabIn() {}, openResourceIn() {}, closeIn() {}, tabsIn: () => [] },
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject: (_deps, callback) => callback(ctx),
  }
  bundle.apply(ctx)

  const { ZH, GIT_ID, interpolate } = bundle.internals
  const seat = seats.find((row) => row.key === GIT_ID && typeof row.component === 'function')
  assert.ok(seat !== undefined, 'the panel registers a body')

  // Stable across renders, as the shell's is: a fresh `tab` per call would
  // restart every effect that names it. `visible` is the one field that changes,
  // when a tab is switched away from and back to.
  const tab = {
    sessionId: 'session',
    visible: true,
    signal: undefined,
    actions: Object.freeze({ bindCommands: () => () => {} }),
  }

  const element = () =>
    runtime.React.createElement(seat.component, {
      t: (key, params) => interpolate(ZH[key] ?? key, params),
      ctx,
      sessionId: 'session',
      useTabInfo: () => ({ tab }),
    })

  const summaryValue = () => {
    const input = runtime.elements().find((host) => host.props['data-lite-git-summary'] !== undefined)
    return input === undefined ? undefined : input.props.value
  }

  return {
    mount: () => runtime.mount(element(), 'open'),
    pump: runtime.pump,
    window,
    calls,
    commits,
    repo,
    summaryValue,
    /** The paths the panel is showing as ticked right now. */
    ticked() {
      return runtime
        .elements()
        .filter((host) => host.props['data-lite-git-tick'] !== undefined)
        .filter((host) => host.props['aria-checked'] === 'true')
        .map((host) => host.props['data-lite-git-tick'])
    },
    typeSummary(value) {
      const input = runtime.elements().find((host) => host.props['data-lite-git-summary'] !== undefined)
      input.props.onChange({ target: { value } })
      return runtime.pump('type')
    },
    /** Press one row's tick, the way a user unticking a file does. */
    async untick(path) {
      const row = runtime.elements().find((host) => host.props['data-lite-git-tick'] === path)
      assert.ok(row !== undefined, `the row for ${path} is rendered`)
      row.props.onClick({ stopPropagation() {} })
      await runtime.pump('untick')
    },
    /**
     * Press a row itself — the whole row, not its tick — optionally with Shift.
     *
     * A row click is what a Shift-range is measured with: pressing the tick is
     * the same gesture for one row, but the range has to know which row the
     * pointer landed on, and the row is the thing that carries that.
     */
    /**
     * Press a row's tick — the checkbox, which is the only control that changes a
     * file's state.
     *
     * `shift` is passed through because a Shift-range is a range *of ticks*: the
     * gesture starts and ends on the boxes, not on the rows around them.
     */
    async clickRow(path, options = {}) {
      const tick = runtime.elements().find((host) => host.props['data-lite-git-tick'] === path)
      assert.ok(tick !== undefined, `the tick for ${path} is rendered`)
      tick.props.onClick({ shiftKey: options.shift === true, stopPropagation() {} })
      await runtime.pump(`click ${path}`)
    },
    /** Let Shift go: the batch is over and the next press starts a new one. */
    async releaseShift() {
      const event = new Event('keyup')
      event.key = 'Shift'
      window.dispatchEvent(event)
      await runtime.pump('release shift')
    },
    /** Press the commit button with a Summary filled in. */
    async commit() {
      await this.typeSummary('a commit')
      const button = runtime
        .elements()
        .find((host) => host.props['data-lite-git-commit'] !== undefined && host.props.disabled !== true)
      assert.ok(button !== undefined, 'the commit button is enabled')
      button.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 60))
      await runtime.pump('commit')
    },
    /** Fire a return and let the debounce plus the read settle. */
    async returnTo() {
      // Past the cooldown the panel keeps between returns: a return inside it is
      // deliberately dropped, and that is asserted on its own below.
      await new Promise((resolve) => setTimeout(resolve, 1300))
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 220))
      await runtime.pump('return')
    },
    /** Fire a return twice, inside the cooldown. */
    async returnTwice() {
      await new Promise((resolve) => setTimeout(resolve, 1300))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 220))
      await runtime.pump('return twice')
    },
    /**
     * Switch the tab away and back, the way the shell does: `visible` flips.
     *
     * This is the "the user opened the tab" signal, and it must be honoured even
     * when it arrives inside the cooldown — the cooldown exists to collapse a
     * burst of overlapping signals, not to drop the one that means the panel just
     * appeared.
     */
    async switchAwayAndBack() {
      tab.visible = false
      await runtime.pump('switch away')
      tab.visible = true
      // Render first — the effect that schedules the return only runs on a render —
      // then let the 150ms debounce fire and the read settle.
      await runtime.pump('switch back')
      await new Promise((resolve) => setTimeout(resolve, 220))
      await runtime.pump('switch back settled')
    },
  }
}

// -------------------------------------------------------------------- checks

test('opening the panel reads the list and fills the Summary', async () => {
  const panel = createPanel({ script: 'echo 1.4.2' })
  await panel.mount()
  // The script half has to work on the FIRST open, when this render's closure
  // still describes a panel with no script at all.
  assert.deepEqual(panel.calls, ['status', 'runScript'])
  assert.equal(panel.summaryValue(), '1.4.2')
})

test('opening with no script is one read, and nothing else', async () => {
  const panel = createPanel({ script: '' })
  await panel.mount()
  assert.deepEqual(panel.calls, ['status'])
  assert.equal(panel.summaryValue(), '')
})

test('returning to the panel reads the list and fills an empty Summary', async () => {
  const panel = createPanel({ script: 'echo 1.4.2' })
  await panel.mount()
  await panel.returnTo()
  // mount + return, each a read; the second one also fills.
  assert.deepEqual(panel.calls, ['status', 'runScript', 'status', 'runScript'])
})

test('a Summary the user typed is never replaced', async () => {
  const panel = createPanel({ script: 'echo 1.4.2' })
  await panel.mount()
  await panel.typeSummary('hand written')
  await panel.returnTo()
  // The read still happens — the list may be stale — but the script stays away.
  assert.deepEqual(panel.calls, ['status', 'runScript', 'status'])
  assert.equal(panel.summaryValue(), 'hand written')
})

test('a Summary the script wrote is refilled on a return', async () => {
  const panel = createPanel({ script: 'echo 1.4.2' })
  await panel.mount()
  await panel.returnTo()
  assert.equal(panel.summaryValue(), '1.4.2')
  assert.equal(panel.calls.filter((action) => action === 'runScript').length, 2)
})

test('a burst of returns is one read', async () => {
  const panel = createPanel({ script: '' })
  await panel.mount()
  await panel.returnTwice()
  assert.deepEqual(panel.calls, ['status', 'status'])
})

test('switching the tab away and back is a return even inside the cooldown', async () => {
  const panel = createPanel({ script: 'echo 1.4.2' })
  await panel.mount()
  // Straight from the open, well inside the cooldown.
  await panel.switchAwayAndBack()
  assert.deepEqual(panel.calls, ['status', 'runScript', 'status', 'runScript'])
})

// ------------------------------------------------- what a refresh ticks
//
// A tick is the panel's own choice, not the index, so there is no "staging"
// request to observe any more and no memory of what the panel once staged. What
// has to hold instead is much simpler and is what these tests pin: everything is
// ticked unless the user said otherwise, a refresh never changes that, and the
// box can never come back half-drawn.

test('every changed file is ticked the moment the list arrives', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'new.txt', kind: 'untracked' }] })
  await panel.mount()
  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'b.txt', 'new.txt'])
  // Nothing was asked of the repository: the tick is local, which is the whole
  // point — one read, and no `git add` of the user's index.
  assert.deepEqual(panel.calls, ['status'])
})

test('a repository whose index is not empty opens fully ticked too', async () => {
  // The old rule refused to tick anything when the index already held changes, on
  // the theory that somebody else had chosen. A tick is now about the next commit
  // rather than about the index, so that caution is gone: Desktop opens with
  // everything included, and a commit built from a temporary index leaves whatever
  // a terminal staged exactly where it was.
  const panel = createPanel({ files: [{ path: 'a.txt', staged: true }, { path: 'b.txt' }] })
  await panel.mount()
  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'b.txt'])
  assert.deepEqual(panel.calls, ['status'])
})

test('a file that appears while the panel is away is ticked, and the one the user unticked is not', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }] })
  await panel.mount()

  // The user decides b.txt is not part of this commit.
  await panel.untick('b.txt')
  assert.deepEqual(panel.ticked(), ['a.txt'])

  // The worktree moves on while the panel is not being looked at.
  panel.repo.add({ path: 'c.txt', kind: 'untracked' })
  await panel.returnTo()

  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'c.txt'])
})

test('a return with nothing new keeps the untick', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }] })
  await panel.mount()
  await panel.untick('a.txt')
  assert.deepEqual(panel.ticked(), [])

  await panel.returnTo()
  assert.deepEqual(panel.ticked(), [], 'the untick survived the refresh')
})

test('a conflict is never ticked, whatever the default is', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'clash.txt', conflicted: true }] })
  await panel.mount()
  // Committing a conflict would record a resolution nobody made.
  assert.deepEqual(panel.ticked(), ['a.txt'])
})

test('a file that is half staged in a terminal still reads as a plain tick', async () => {
  // The report this whole change answers: a file nobody ticked showed up as an
  // indeterminate box, because its index and worktree differed. The box reads the
  // panel's choice now, so `MM` — whether this panel or a terminal produced it —
  // has no way to draw a third state.
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'half.txt', staged: true, partial: true }] })
  await panel.mount()
  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'half.txt'])

  await panel.returnTo()
  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'half.txt'], 'and a refresh does not change that')

  // The index really is untouched: no request went out at all.
  assert.deepEqual(panel.calls, ['status', 'status'])
})

test('a file the user unticked stays unticked even after it changes again', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }] })
  await panel.mount()
  await panel.untick('b.txt')

  panel.repo.edit('b.txt', { added: 5, deleted: 0 })
  await panel.returnTo()

  assert.deepEqual(panel.ticked(), ['a.txt'], 'the deliberate untick is still respected')
})

test('a file that comes back with the same name after leaving the list is ticked again', async () => {
  // Without pruning, the untick set would only ever grow: a path that was
  // unticked, committed, and then changed again would come back unticked for a
  // reason the user cannot see.
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }] })
  await panel.mount()
  await panel.untick('b.txt')
  assert.deepEqual(panel.ticked(), ['a.txt'])

  // b.txt is reverted, so it is not in the list any more.
  panel.repo.files = panel.repo.files.filter((file) => file.path !== 'b.txt')
  await panel.returnTo()
  assert.deepEqual(panel.ticked(), ['a.txt'])

  // ...and comes back changed.
  panel.repo.add({ path: 'b.txt' })
  await panel.returnTo()
  assert.deepEqual(panel.ticked().sort(), ['a.txt', 'b.txt'])
})

// -------------------------------------------------------- the Shift range
//
// The gesture, in the user's words: 首末点击的前后都按住 Shift 就改变中间所有的状态；
// 不松开再点就改变端点，松开就是新一批；改变状态就是反转. So: the range runs from the
// anchor to the pressed row *including both ends*, it inverts rather than sets,
// and holding Shift keeps the anchor so each press only moves the far end.

test('Shift-clicking a row inverts the rows between it and the anchor', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'c.txt' }, { path: 'd.txt' }] })
  await panel.mount()
  // Everything starts ticked. Press b — that is where the batch starts — then
  // hold Shift and press d: everything between b and d inverts, d included, so c
  // and d come unticked. b stays as its own press left it: it is the anchor, not
  // part of the range.
  await panel.clickRow('b.txt')
  assert.deepEqual(panel.ticked(), ['a.txt', 'c.txt', 'd.txt'], 'a plain press on the first row is still a plain press')

  await panel.clickRow('d.txt', { shift: true })
  assert.deepEqual(panel.ticked(), ['a.txt'], 'c and d inverted; the anchor b keeps the untick its own press gave it')

  // Pressing back towards the anchor retraces the range rather than inverting it
  // a second time: d comes back, c stays inverted.
  await panel.clickRow('c.txt', { shift: true })
  assert.deepEqual(panel.ticked(), ['a.txt', 'd.txt'], 'd comes back; the anchor b is still unticked from its own press')
})

test('holding Shift keeps the same anchor, so each press moves the far end', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'c.txt' }, { path: 'd.txt' }] })
  await panel.mount()

  await panel.clickRow('a.txt')
  assert.deepEqual(panel.ticked(), ['b.txt', 'c.txt', 'd.txt'])

  // Hold Shift, press c then d: the anchor is still a.txt throughout, so the
  // range grows — it does not restart from c.
  await panel.clickRow('c.txt', { shift: true })
  assert.deepEqual(panel.ticked(), ['d.txt'])
  await panel.clickRow('d.txt', { shift: true })
  assert.deepEqual(panel.ticked(), [])
})

test('letting Shift go starts a new batch from the row pressed last', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'c.txt' }, { path: 'd.txt' }] })
  await panel.mount()

  // a is the anchor; Shift to d inverts b..d, so everything is unticked.
  await panel.clickRow('a.txt')
  await panel.clickRow('d.txt', { shift: true })
  assert.deepEqual(panel.ticked(), [])

  await panel.releaseShift()

  // A new batch, measured from d — the row the last batch stopped on. Pressing b
  // with Shift inverts c only: d is the anchor and keeps the untick it ended the
  // last batch with, and b keeps its own state too — the range is what lies
  // between the two ends, which is "松开就是新一批".
  await panel.clickRow('b.txt', { shift: true })
  assert.deepEqual(panel.ticked(), ['b.txt', 'c.txt'], 'the new range runs from the anchor d back to b, turning c on again')
})

test('a Shift range inverts each row against how it was, it does not clear the whole range', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'c.txt' }, { path: 'd.txt' }] })
  await panel.mount()
  await panel.untick('b.txt')
  await panel.untick('c.txt')
  assert.deepEqual(panel.ticked(), ['a.txt', 'd.txt'])

  await panel.clickRow('b.txt')
  assert.deepEqual(panel.ticked(), ['a.txt', 'b.txt', 'd.txt'])

  await panel.clickRow('d.txt', { shift: true })
  // The range from b to d is inverted against the snapshot taken when this batch
  // started: c was unticked and comes back, d was ticked and goes off. The anchor
  // b keeps the tick its own press gave it.
  assert.deepEqual(panel.ticked(), ['a.txt', 'b.txt', 'c.txt'])
})

test('a conflicted row in the middle of a range is left alone', async () => {
  const panel = createPanel({
    files: [{ path: 'a.txt' }, { path: 'clash.txt', conflicted: true }, { path: 'c.txt' }],
  })
  await panel.mount()
  await panel.clickRow('a.txt')
  await panel.clickRow('c.txt', { shift: true })
  // The conflict is never ticked, so it is neither part of the range nor counted
  // as one of the rows the range turned off.
  assert.deepEqual(panel.ticked(), [])
  assert.deepEqual(panel.calls, ['status'], 'no request went out: a tick is a local choice')
})

// ------------------------------------------------------ what a commit sends

test('the commit carries exactly the ticked paths', async () => {
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }, { path: 'c.txt' }] })
  await panel.mount()
  await panel.untick('b.txt')

  await panel.commit()

  assert.equal(panel.commits.length, 1)
  assert.deepEqual(panel.commits[0].paths, ['a.txt', 'c.txt'], 'only the ticked ones')
  assert.equal(panel.commits[0].summary, 'a commit')
})

test('everything left is ticked again after a commit', async () => {
  // Desktop rebuilds the working-directory list and includes every new file; the
  // equivalent here is that the untick set empties, so anything that survived a
  // partly-ticked commit is included next time.
  const panel = createPanel({ files: [{ path: 'a.txt' }, { path: 'b.txt' }] })
  await panel.mount()
  await panel.untick('b.txt')
  await panel.commit()
  assert.deepEqual(panel.commits.at(-1).paths, ['a.txt'])

  // b.txt is the only change left, and it is not excluded any more.
  assert.deepEqual(panel.ticked(), ['b.txt'])
})
