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
// Self-contained: every source lives inside this package (src/). The build
// MUST NOT reach outside the package — git installs run the prepare script in
// an isolated checkout (publish.zh.md), and the bundle sources are vendored
// here as the single source of truth for the release.
const OUT = {
  'index.js': join(root, 'src', 'bundle.ts'),
  'research-ui.js': join(root, 'src', 'research-ui.ts'),
  'arxiv-search.js': join(root, 'src', 'arxiv-search.ts'),
  'lit-score.js': join(root, 'src', 'lit-score.ts'),
  'research-state.js': join(root, 'src', 'research-state.ts'),
  'stall-check.js': join(root, 'src', 'stall-check.ts'),
  'peer-review.js': join(root, 'src', 'peer-review.ts'),
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
