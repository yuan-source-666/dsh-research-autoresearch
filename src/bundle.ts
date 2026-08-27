/**
 * dsh-research-autoresearch — bundle entry (node half).
 *
 * Mounts the researchUi control plane and the five AutoResearch tools as one
 * unit. Each tool keeps its own enableCards config; the bundle maps its flat
 * config onto them so a single cordis.yml block controls everything. The
 * browser half (lib/client.js) pairs with the 'research-ui' settings
 * namespace this entry installs.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { apply as applyUi } from './research-ui.ts'
import { apply as applyArxiv } from './arxiv-search.ts'
import { apply as applyLit } from './lit-score.ts'
import { apply as applyState } from './research-state.ts'
import { apply as applyStall } from './stall-check.ts'
import { apply as applyReview } from './peer-review.ts'

export interface Config {
  /** Master kill-switch for the whole suite. */
  enabled: boolean
  /** research-ui master: force ALL five card features on (settings layer). */
  defaultCards: boolean
  /** Per-feature durable toggles; each also seeds its tool's enableCards. */
  literatureCards?: boolean
  scoringCards?: boolean
  panelCards?: boolean
  guardianCards?: boolean
  reviewCards?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  defaultCards: z.boolean().default(false),
  literatureCards: z.boolean().default(false),
  scoringCards: z.boolean().default(false),
  panelCards: z.boolean().default(false),
  guardianCards: z.boolean().default(false),
  reviewCards: z.boolean().default(false),
})

export const name = 'dsh-research-autoresearch'
// The bundle applies research-ui which registers tools via ctx.tools, so the
// entry itself must declare the injection (cordis checks the plugin entry,
// not the imported helper module).
export const inject = ['tools']

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  applyUi(ctx, {
    defaultCards: config.defaultCards,
    literatureCards: config.literatureCards ?? false,
    scoringCards: config.scoringCards ?? false,
    panelCards: config.panelCards ?? false,
    guardianCards: config.guardianCards ?? false,
    reviewCards: config.reviewCards ?? false,
  })
  applyArxiv(ctx, { enableCards: config.literatureCards ?? false })
  applyLit(ctx, { enableCards: config.scoringCards ?? false })
  applyState(ctx, { enableCards: config.panelCards ?? false })
  applyStall(ctx, { enableCards: config.guardianCards ?? false })
  applyReview(ctx, { enableCards: config.reviewCards ?? false })
}
// NOTE: no default export on purpose. The loader unwraps with
// `exports = exports.default ?? exports` (cordis-plugin-loader unwrapExports),
// so any default export SHADOWS the named inject declaration and the boot
// dies with `cannot get property "tools" without inject`. Keep this module
// pure-named, exactly like dsh-github-manager's entry.
