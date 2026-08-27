/**
 * Literature Quality Score (LQS) tool — the second stage of the AutoResearch
 * literature funnel.
 *
 * Scores each Recall-stage candidate on a 0-10 weighted scale, then bucketizes
 * it into must-cite / conditional / dropped. The scoring formula and thresholds
 * follow Deli Chen's AutoResearch framework:
 *
 *   LQS = recency(30%) + citation(25%) + venue(20%) + institution(10%) + acceptance(15%)
 *   Citation-window correction: papers younger than ~400 days cannot have
 *   accrued citations yet, so the citation component is imputed as the mean
 *   of the other components (scale-preserving) and flagged via
 *   citationEmergingImputed. Without this, fresh frontier literature is
 *   systematically false-killed (measured on a 2026 batch: all dropped).
 *
 *   >= 7.0  → must-cite   (high quality + high relevance)
 *   5.0-7.0 → conditional (fills taxonomy gap)
 *   < 5.0   → dropped
 *
 * The tool accepts the raw ArxivResult[] produced by arxiv_search, enriches
 * each entry with citation counts (from Semantic Scholar), and emits the
 * scored + classified list ready for the Classify stage.
 *
 * @module @deepseek-ai/dsh-tool-lit-score
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-lit-score'
export const inject = ['tools']

/** One scored candidate, extending ArxivResult with LQS components and a tier. */
export interface ScoredEntry {
  arxivId: string
  title: string
  authors: string[]
  primaryCategory: string
  published: string
  url: string
  citationCount: number
  /** True when the paper is <400 days old and the citation sub-score is the
   * mean of the other components (citation-window correction, see tool docs). */
  citationEmergingImputed: boolean
  /** Sub-scores on 0-10. */
  recency: number
  citation: number
  venue: number
  institution: number
  acceptance: number
  /** Weighted LQS, 0-10. */
  lqs: number
  /** Bucket: 'must-cite' | 'conditional' | 'dropped'. */
  tier: 'must-cite' | 'conditional' | 'dropped'
}

export interface ScoreOutput {
  scored: number
  mustCite: number
  conditional: number
  dropped: number
  entries: ScoredEntry[]
  /** UI gate stamped by execute() into persisted meta (never part of the canonical value). */
  ui?: { cards: boolean }
}

/**
 * Fetch the citation count for an arXiv id from Semantic Scholar's public API.
 * Returns 0 on any failure (the recency and venue components still score).
 */
async function fetchCitationCount(arxivId: string, signal: AbortSignal): Promise<number> {
  try {
    const url = 'https://api.semanticscholar.org/graph/v1/paper/ARXIV:'
      + arxivId + '?fields=citationCount'
    const res = await fetch(url, { signal })
    if (!res.ok) return 0
    const body = await res.json() as { citationCount?: number }
    return body.citationCount ?? 0
  } catch {
    return 0
  }
}

/** Recency score: papers from the last 12 months get 10, decaying linearly. */
function scoreRecency(published: string, now: number = Date.now()): number {
  if (!published) return 2 // unknown date — small floor.
  const pubMs = Date.parse(published)
  if (isNaN(pubMs)) return 2
  const months = (now - pubMs) / (1000 * 60 * 60 * 24 * 30)
  if (months <= 12) return 10
  if (months <= 24) return 8
  if (months <= 48) return 6
  if (months <= 72) return 4
  return 2
}

/** Citation score on a log scale: 0→0, 10→~4, 100→~6.5, 1000→~9, 5000→10. */
function scoreCitation(count: number): number {
  if (count <= 0) return 0
  if (count >= 5000) return 10
  // log10(count/10) * 2 + 4, clamped.
  return Math.max(0, Math.min(10, Math.log10(Math.max(count, 1)) * 2 + 2))
}

/**
 * Venue score: arXiv preprints without a known accepted venue score lower
 * (3). Papers with a primary category that has a strong conference track get
 * a small bonus even on arXiv, since they are likely headed there. This is a
 * coarse proxy; the Upgrade stage (DBLP) refines the actual venue.
 */
function scoreVenue(primaryCategory: string): number {
  if (!primaryCategory) return 3
  // cs.* and stat.* papers typically target top-tier venues.
  if (primaryCategory.startsWith('cs.')) return 4
  if (primaryCategory.startsWith('stat.')) return 4
  if (primaryCategory.startsWith('math.')) return 3.5
  if (primaryCategory.startsWith('physics.')) return 3
  return 3
}

/**
 * Institution score: a coarse heuristic from the first author's affiliation
 * string. We don't have affiliation data from arXiv alone, so this is a weak
 * proxy (author count is a mild signal of a larger consortium). Real
 * deployments should override this with a real affiliation lookup.
 */
function scoreInstitution(authors: string[]): number {
  if (!authors || authors.length === 0) return 2
  if (authors.length >= 8) return 5 // large multi-institution collaboration.
  if (authors.length >= 4) return 4
  if (authors.length >= 2) return 3.5
  return 3
}

/**
 * Acceptance score: we don't have venue acceptance data at arXiv-only stage.
 * Use a flat prior; the Upgrade stage (DBLP) refines this.
 */
function scoreAcceptance(_arxivId: string): number {
  return 3
}

/** Compute the weighted LQS from components. */
function computeLQS(recency: number, citation: number, venue: number, institution: number, acceptance: number): number {
  return recency * 0.30 + citation * 0.25 + venue * 0.20 + institution * 0.10 + acceptance * 0.15
}

/** Bucket the LQS into the three tiers. */
function tierFor(lqs: number): 'must-cite' | 'conditional' | 'dropped' {
  if (lqs >= 7.0) return 'must-cite'
  if (lqs >= 5.0) return 'conditional'
  return 'dropped'
}

const TOOL_DESCRIPTION =
  'Score arXiv candidates from arxiv_search with the Literature Quality Score (LQS) formula. '
  + 'LQS = recency(30%) + citation(25%) + venue(20%) + institution(10%) + acceptance(15%), '
  + 'fetched from arXiv metadata and Semantic Scholar citation counts. Bucketizes results into '
  + 'must-cite (>=7.0), conditional (5.0-7.0), or dropped (<5.0). Papers younger than ~400 '
  + 'days get a citation-window correction: the citation component is imputed as the mean of '
  + 'the other components (fresh literature cannot have accrued citations yet) and flagged '
  + 'citationEmergingImputed. This is the SCORE stage of the AutoResearch literature funnel; '
  + 'use after arxiv_search, before classify.'

/** Card-visualization switch, mirroring tool-bash's enableRunInBackground config gate. */
export interface Config {
  /**
   * Inject this tool's UI progress cards at load (需要时注入); default false
   * keeps presenters returning undefined = generic fallback (不需要时关闭).
   * The optional researchUi service can still flip this per session at runtime.
   */
  enableCards?: boolean
}

export const Config: z<Config> = z.object({
  enableCards: z.boolean().default(true),
})

/** Structural probe of the optional researchUi service (tutorial ch.3 optional dependency). */
interface ResearchUiProbe {
  getCardEnabled(feature: string): boolean | undefined
}

/** Which researchUi feature flag gates this tool's cards. */
const UI_FEATURE = 'scoring'

export function apply(ctx: Context, config: Config): void {
  const getUi = (): ResearchUiProbe | undefined =>
    (ctx as { get?: (name: string) => unknown }).get?.('researchUi') as ResearchUiProbe | undefined
  // Effective gate for execute-time stamping: runtime override wins, else own config.
  const gate = (): boolean => getUi()?.getCardEnabled(UI_FEATURE) ?? config.enableCards
  ctx.tools.register(defineTool({
    name: 'lit_score',
    description: TOOL_DESCRIPTION,
    parameters: {
      results: {
        type: 'array',
        required: true,
        description: 'ArxivResult[] from arxiv_search to be scored.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            arxivId: { type: 'string', required: true },
            title: { type: 'string', required: true },
            authors: { type: 'array', items: { type: 'string' }, required: true },
            abstract: { type: 'string' },
            primaryCategory: { type: 'string', required: true },
            categories: { type: 'array', items: { type: 'string' } },
            published: { type: 'string', required: true },
            url: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scored: { type: 'integer', required: true },
          mustCite: { type: 'integer', required: true },
          conditional: { type: 'integer', required: true },
          dropped: { type: 'integer', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                arxivId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                authors: { type: 'array', items: { type: 'string' }, required: true },
                primaryCategory: { type: 'string', required: true },
                published: { type: 'string', required: true },
                url: { type: 'string', required: true },
                citationCount: { type: 'integer', required: true },
                citationEmergingImputed: { type: 'boolean', required: true },
                recency: { type: 'number', required: true },
                citation: { type: 'number', required: true },
                venue: { type: 'number', required: true },
                institution: { type: 'number', required: true },
                acceptance: { type: 'number', required: true },
                lqs: { type: 'number', required: true },
                tier: { type: 'string', required: true, enum: ['must-cite', 'conditional', 'dropped'] },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: 'LQS scored ' + value.scored + ' papers: '
          + value.mustCite + ' must-cite, '
          + value.conditional + ' conditional, '
          + value.dropped + ' dropped. '
          + 'Top must-cite: ' + value.entries.filter(e => e.tier === 'must-cite').slice(0, 5)
            .map(e => e.arxivId + ' (LQS ' + e.lqs.toFixed(1) + ')').join('; '),
      }],
      presentationMeta: (_args, value) => ({ ...value, ui: { cards: gate() } }),
    },
    async execute(args, exec) {
      const results = args.results
      if (!results || results.length === 0) {
        throw new Error('lit_score requires a non-empty results array')
      }
      const entries: ScoredEntry[] = []
      for (const r of results) {
        const citationCount = await fetchCitationCount(r.arxivId, exec.signal)
        const recency = scoreRecency(r.published)
        const venue = scoreVenue(r.primaryCategory)
        const institution = scoreInstitution(r.authors ?? [])
        const acceptance = scoreAcceptance(r.arxivId)
        // Citation-window correction: a paper younger than ~400 days has not
        // had time to accrue citations, so a raw citation score systematically
        // false-kills the freshest literature (measured: 22/22 of a 2026
        // frontier batch dropped with citation=0.00). Standard missing-index
        // treatment applies: impute the citation component with the MEAN of
        // the other components — scale-preserving, neither inflating nor
        // punishing — and flag the entry so the substitution stays auditable.
        const daysOld = (Date.now() - Date.parse(r.published)) / 86400000
        const emerging = Number.isFinite(daysOld) && daysOld >= 0 && daysOld < 400
        const citation = emerging
          ? (recency + venue + institution + acceptance) / 4
          : scoreCitation(citationCount)
        const lqs = computeLQS(recency, citation, venue, institution, acceptance)
        const tier = tierFor(lqs)
        entries.push({
          arxivId: r.arxivId,
          title: r.title,
          authors: r.authors ?? [],
          primaryCategory: r.primaryCategory,
          published: r.published,
          url: r.url,
          citationCount,
          citationEmergingImputed: emerging,
          recency,
          citation,
          venue,
          institution,
          acceptance,
          lqs,
          tier,
        })
      }
      // Sort by LQS descending.
      entries.sort((a, b) => b.lqs - a.lqs)
      const output: ScoreOutput = {
        scored: entries.length,
        mustCite: entries.filter(e => e.tier === 'must-cite').length,
        conditional: entries.filter(e => e.tier === 'conditional').length,
        dropped: entries.filter(e => e.tier === 'dropped').length,
        entries,
      }
      return output
    },
    presentCall: (args) => {
      if (!config.enableCards) return undefined
      return {
        card: 'generic',
        kind: 'other',
        title: 'LQS 评分：' + args.results.length + ' 篇候选',
      }
    },
    // Completed card: the non-dropped papers with LQS + tier as a search paths card,
    // so a capable UI lists each retained paper as one expandable row.
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta as ScoreOutput
      if (!v || !Array.isArray(v.entries) || typeof v.mustCite !== 'number') return undefined
      if (!v.ui || v.ui.cards !== true) return undefined
      const kept = v.entries.filter(e => e.tier !== 'dropped')
      return {
        card: 'search',
        shape: 'paths',
        title: '评分完成：' + v.mustCite + ' 必引 / ' + v.conditional + ' 条件 / ' + v.dropped + ' 剔除',
        paths: kept.map(e => e.arxivId + '  LQS ' + e.lqs.toFixed(2) + '  [' + e.tier + '] ' + e.title),
        truncated: false,
        total: kept.length,
      }
    },
  }))
}
