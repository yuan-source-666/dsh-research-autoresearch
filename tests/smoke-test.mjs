/**
 * Host-half smoke for the installed/build bundle: mounts the bundle on a
 * Cordis-shaped fake context and drives the paths that previously broke in
 * production (lossless JSON) plus the settings -> researchUi sync the Web
 * card depends on. Run: node tests/smoke-test.mjs
 */
import { Service } from '@deepseek-ai/cordis'
import * as bundle from '../lib/index.js'

function assertLossless(value, path) {
  if (value === undefined) throw new Error('undefined at ' + path)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(value + ' at ' + path)
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') throw new Error(typeof value + ' at ' + path)
  if (Array.isArray(value)) { value.forEach((v, i) => assertLossless(v, path + '[' + i + ']')); return }
  if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) assertLossless(v, path + '.' + k) }
}

class FakeTools extends Service {
  constructor(ctx) { super(ctx, 'tools'); this.registered = new Map() }
  register(def) { this.registered.set(def.name, def) }
}
class FakeSystemPrompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  prepend() {}
}
class FakeSettings extends Service {
  constructor(ctx) { super(ctx, 'settings'); this.sections = new Map() }
  register(ns, schema, opts) {
    const entry = {
      base: opts.base,
      _watchers: [],
      get: () => entry.base,
      watch: (fn) => { entry._watchers.push(fn) },
      update(partial) { entry.base = { ...entry.base, ...partial }; for (const fn of entry._watchers) fn() },
    }
    this.sections.set(String(ns), entry)
    return entry
  }
}
// One service map both worlds write into: real cordis Services go through
// ctx.reflect.provide, the dependency-free shims through ctx.__services.
const ctx = {
  fiber: { state: 1 },
  __services: new Map(),
  reflect: { provide(name, svc) { ctx[name] = svc; ctx.__services.set(name, svc); return () => {} } },
  get(n) { return ctx.__services.get(n) },
  plugin(P) { const inst = new P(ctx); return { instance: inst } },
  effect(fn) { return typeof fn === 'function' ? fn() : undefined },
  inject(deps, cb) { if (deps.every((d) => ctx.__services.has(d))) cb(ctx) },
}
const tools = ctx.plugin(FakeTools).instance
ctx.plugin(FakeSystemPrompt)
ctx.plugin(FakeSettings)
bundle.apply(ctx, { enabled: true, defaultCards: false, literatureCards: true, scoringCards: true, panelCards: true, guardianCards: true, reviewCards: true })

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m) } else { fail++; console.log('  FAIL  ' + m) } }
const ex = (n, a) => ({ callId: '1', name: n, arguments: a, agent: null, token: 0, signal: new AbortController().signal })
const os = await import('node:os')
const path = await import('node:path')
const fs = await import('node:fs/promises')
const dir = path.join(os.tmpdir(), 'dsh-research-smoke-' + Date.now())

ok(Array.isArray(bundle.inject) && bundle.inject.includes('tools'), "boot-order contract: entry declares inject ['tools'] (regression: missing it crashed a real restart)")
// The loader unwraps "exports.default ?? exports": a default export would
// shadow the named inject and brick the boot (this exact bug shipped twice).
ok(bundle.default === undefined, 'entry has NO default export (would shadow inject in unwrapExports)')
ok([...tools.registered.keys()].sort().join(',') === 'arxiv_search,lit_score,peer_review,research_state,research_ui_switch,stall_check', '6 tools registered')
// 0.3.0 literature-driven upgrades: judge disagreement gate + emerging citation imputation
{
  const exU = (n, a) => ({ callId: 'u', name: n, arguments: a, agent: null, token: 0, signal: new AbortController().signal })
  const v5 = [9, 2, 3, 4, 9].map((score, i) => ({ personaId: 'p' + i, role: 'r', score, critique: 'x' }))
  const polar = await tools.registered.get('peer_review').execute({ verdicts: v5 }, exU('peer_review', {}))
  if (polar.judgeDisagreement !== 7) throw new Error('disagreement spread wrong: ' + polar.judgeDisagreement)
  if (!(polar.scoreBand[0] <= polar.medianScore && polar.medianScore <= polar.scoreBand[1])) throw new Error('band must contain median')
  if (!polar.weaknessTags.includes('judge_disagreement')) throw new Error('polarized panel must auto-tag judge_disagreement')
  const calm = await tools.registered.get('peer_review').execute(
    { verdicts: [9, 9, 8, 9, 9].map((score, i) => ({ personaId: 'p' + i, role: 'r', score, critique: 'x' })) }, exU('peer_review', {}))
  if (calm.nextAction !== 'accept') throw new Error('converged strong panel should accept, got ' + calm.nextAction)
  const strong = await tools.registered.get('peer_review').execute(
    { verdicts: [10, 10, 9, 6, 10].map((score, i) => ({ personaId: 'p' + i, role: 'r', score, critique: 'x' })) }, exU('peer_review', {}))
  if (strong.medianScore >= 8.5 && strong.nextAction === 'accept') throw new Error('polarized 8.5+ panel must NOT accept')
  console.log('  PASS  peer_review 0.3.0: disagreement gate + robust band')
  // emerging imputation: mock S2 with 0 citations, fresh paper must not be dropped
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ citationCount: 0 }) }))
  try {
    const fresh = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z'
    const old = '2024-03-01T00:00:00Z'
    const mk = (id, published) => ({ arxivId: id, title: 't', authors: ['A. Author'], primaryCategory: 'cs.LG', published, url: 'u' })
    const scored = await tools.registered.get('lit_score').execute(
      { results: [mk('9999.00001', fresh), mk('9999.00002', old)] }, exU('lit_score', {}))
    const e1 = scored.entries.find((e) => e.citationEmergingImputed)
    const e2 = scored.entries.find((e) => !e.citationEmergingImputed)
    if (!e1 || e1.citationCount !== 0) throw new Error('emerging entry mislabeled')
    if (!e2 || e2.citation !== 0) throw new Error('old paper should keep raw zero-citation score')
    if (e1.tier === 'dropped') throw new Error('emerging imputation failed to rescue fresh paper: lqs=' + e1.lqs)
    console.log('  PASS  lit_score 0.3.0: citation-window correction (emerging lqs=' + e1.lqs.toFixed(2) + ' vs old ' + e2.lqs.toFixed(2) + ')')
  } finally { globalThis.fetch = realFetch }
}
const ui = ctx.researchUi
ok(!!ui, 'researchUi service live')

// settings -> service sync (the durable layer the Web card edits).
// Real dsh-settings routes through the injected service's register(); the
// dependency-free shim stores sections on ctx.__settingsSections.
const section = (ctx.settings.sections && ctx.settings.sections.get('research-ui')) ?? ctx.__settingsSections.get('research-ui')
section.update({ panelCards: true })
ok(ui.getCardEnabled('panel') === true && ui.getCardEnabled('scoring') === true, 'field-level settings reach the service (config-on features stay on)')
section.update({ panelCards: false })
ok(ui.getCardEnabled('panel') === undefined, 'panelCards=false releases the override back to follow')
ok(ui.getCardEnabled('scoring') === true, 'other fields untouched by the release')

// lossless paths that broke in 0.1.1
const wp = { task_dir: dir, op: { op: 'write_progress', progress: { iteration: 1, status: 'in_progress', staleCount: 0, totalFindings: 0 } } }
await tools.registered.get('research_state').execute(wp, ex('research_state', wp))
const rd = { task_dir: dir, op: { op: 'read' } }
const sv = await tools.registered.get('research_state').execute(rd, ex('research_state', rd))
assertLossless(sv, 'state')
ok(!('taskSpec' in sv), 'state without spec omits taskSpec (lossless)')
const st = { task_dir: dir, proposed_direction: 'x', new_findings_this_iteration: 1, session_started_at: new Date().toISOString() }
const stallOut = await tools.registered.get('stall_check').execute(st, ex('stall_check', st))
assertLossless(stallOut, 'stall')
ok(!('perturbationStrategy' in stallOut) && stallOut.recommendation === 'continue', 'stall non-pivot lossless')
const prArgs = { verdicts: [{ personaId: 'R1', role: 'r', score: 8, critique: 'c' }] }
const prOut = await tools.registered.get('peer_review').execute(prArgs, ex('peer_review', prArgs))
assertLossless(prOut, 'review')
ok(!('previousScore' in prOut), 'review without previous omits key')

// card gate stamping
const meta = JSON.parse(JSON.stringify(tools.registered.get('research_state').output.presentationMeta(rd, sv)))
ok(meta.ui && meta.ui.cards === true, 'result-card gate stamped into presentationMeta')

await fs.rm(dir, { recursive: true, force: true })
console.log('smoke-test: ' + pass + ' passed, ' + fail + ' failed')
process.exitCode = fail === 0 ? 0 : 1
