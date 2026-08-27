/**
 * Build dsh-research-autoresearch: strips erasable TypeScript from the six
 * plugin sources + the bundle entry into plain ESM under lib/, rewriting the
 * bundle entry's relative '.ts' import specifiers to '.js'.
 * Node >=22.13 required (module.stripTypeScriptTypes).
 */
import { stripTypeScriptTypes } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const research = join(root, '..')
const OUT = {
  'index.js': join(research, 'dsh-research-autoresearch', 'src', 'bundle.ts'),
  'research-ui.js': join(research, 'tool-research-ui', 'src', 'index.ts'),
  'arxiv-search.js': join(research, 'tool-arxiv-search', 'src', 'index.ts'),
  'lit-score.js': join(research, 'tool-lit-score', 'src', 'index.ts'),
  'research-state.js': join(research, 'tool-research-state', 'src', 'index.ts'),
  'stall-check.js': join(research, 'tool-stall-check', 'src', 'index.ts'),
  'peer-review.js': join(research, 'tool-peer-review', 'src', 'index.ts'),
}
await mkdir(join(root, 'lib'), { recursive: true })
for (const [out, src] of Object.entries(OUT)) {
  let code = await readFile(src, 'utf8')
  if (out === 'index.js') code = code.replace(/\.ts'/g, ".js'")
  const js = stripTypeScriptTypes(code, { mode: 'strip' })
  await writeFile(join(root, 'lib', out), js)
  console.log('built lib/' + out + '  (' + js.length + ' chars)')
}
// import-graph smoke: every bare specifier we emit must be a declared peer
const peers = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-settings']
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const p of Object.keys(OUT)) {
  const t = await readFile(join(root, 'lib', p), 'utf8')
  for (const m of t.matchAll(/^import\s+(?:type\s+)?[\s\S]{0,200}?from\s+'([^']+)'/gm)) {
    const s = m[1]
    if (s.startsWith('.')) continue
    if (s.startsWith('node:')) continue
    if (!peers.includes(s)) throw new Error('undeclared runtime dependency in ' + p + ': ' + s)
  }
}
for (const peer of peers) if (!(peer in (pkg.peerDependencies ?? {}))) console.log('note: peer not declared:', peer)
// the browser half compiles through its own pipeline (src/client -> envelope)
await import('./scripts/build-client.mjs')
console.log('bundle build OK')
