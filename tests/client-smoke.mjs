/**
 * Browser-half smoke: replays lib/client.js against the host's module-loader
 * contract in a vm sandbox — the loader registration, factory entry, locale
 * registration, slot pairing, component render, staging and save-through.
 * No DOM, no React runtime: the same seam-level discipline as the host test.
 * Run: node tests/client-smoke.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let loaded = null
const sandbox = { window: { __ModuleLoader__: { load: (def) => { loaded = def } } }, console, Promise, Object, Error, Symbol, Boolean, Array, String, Map, Set }
vm.createContext(sandbox)
vm.runInContext(src, sandbox)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m) } else { fail++; console.log('  FAIL  ' + m) } }

ok(loaded && loaded.id === 'dsh-research-autoresearch', 'module-loader registers dsh-research-autoresearch')

// Fake host externals matching the observed contract.
const base = { defaultCards: false, literatureCards: false, scoringCards: false, panelCards: false, guardianCards: false, reviewCards: false }
const userDoc = {}
let notify = null
const writes = []
// Real scope contract: writes land in the user layer, the resolved layer
// recomputes, and subscribers are notified.
const scope = {
  subscribe: (fn) => { notify = fn; return () => {} },
  getSnapshot: () => ({ user: { ...userDoc }, base: { ...base }, value: { ...base, ...userDoc }, writable: true }),
  set: (f, v) => { writes.push([f, v]); userDoc[f] = v; notify && notify(); return Promise.resolve() },
  unset: (f) => { writes.push([f, undefined]); delete userDoc[f]; notify && notify(); return Promise.resolve() },
}
const externals = {
  '@deepseek-ai/dsh-client-runtime/client': { createSnapshotStore: (init) => { let v = init; return { get: () => v, set: (nxt) => { v = nxt } } } },
  react: { useState: (v) => [v, () => {}] },
  'react/jsx-runtime': { jsx: (type, props) => ({ type, ...props }), jsxs: (type, props) => ({ type, ...props }) },
}
const mod = loaded.factory((spec) => { if (!(spec in externals)) throw new Error('unexpected external ' + spec); return externals[spec] })
ok(typeof mod.apply === 'function' && mod.LOCALE_NS === 'dsh-research-autoresearch', 'factory entry exports (apply + LOCALE_NS)')

let localeReg = null, slotReg = null
const bctx = {
  effect: (fn) => { fn() },
  locale: { register: (ns, dicts) => { localeReg = { ns, langs: Object.keys(dicts), zhTitle: dicts.zh.title } } },
  settingsScope: { bind: () => scope },
  slots: {
    register: (meta, Comp) => ({ meta, Comp }),
    inject: (name, build) => { slotReg = { name, built: build() } },
  },
}
// Emulate the browser cordis gate: the module is mounted with
// ctx.plugin({ inject: mod.inject, apply }) and ANY service read outside the
// declared inject list throws — the same contract that bricked the node boot.
ok(Array.isArray(mod.inject) && ['locale', 'settingsScope', 'slots'].every((d) => mod.inject.includes(d)), 'client entry declares module-level inject for every touched service')
const allowed = new Set(mod.inject)
const gated = new Proxy(bctx, {
  get(t, prop) {
    if (typeof prop !== 'string' || prop === 'effect' || allowed.has(prop)) return t[prop]
    throw new TypeError('cannot get property "' + prop + '" without inject')
  },
})
mod.apply(gated)
ok(localeReg && localeReg.langs.length === 2 && String(localeReg.zhTitle).includes('科研'), 'zh/en locales registered into the browser locale service')
ok(slotReg.name === 'settings.plugin.item' && slotReg.built.meta.key === 'research-ui', 'card injected: settings.plugin.item keyed research-ui (host pairing)')

// Component render through the slot face (hooks -> useResearchUi, actions spread).
const face = slotReg.built.meta.inject()
const props = { t: (k) => k, useResearchUi: (sel) => sel(face.hooks.researchUi.get()), toggle: face.toggle, save: () => { face.save() }, discard: face.discard }
const closed = slotReg.built.Comp(props)
ok(closed && closed.type === 'li', 'component renders the collapsed card')
face.toggle('panelCards', true)
const dirty = props.useResearchUi((s) => s)
ok(dirty.dirty && dirty.switches.panelCards.value === true, 'toggle stages a draft (dirty + previewed ON)')
await face.save()
ok(writes.length === 1 && writes[0][0] === 'panelCards' && writes[0][1] === true, 'save writes through the settings scope')
const settled = props.useResearchUi((s) => s)
ok(!settled.dirty && settled.switches.panelCards.value && settled.switches.panelCards.overridden, 'committed field: clean, on, marked durable override')

console.log('client-smoke: ' + pass + ' passed, ' + fail + ' failed')
process.exitCode = fail === 0 ? 0 : 1
