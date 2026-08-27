/**
 * Literature Recall tool — the first stage of the AutoResearch literature funnel.
 *
 * Searches arXiv via its public API, deduplicates results, and returns structured
 * candidates ready for the LQS scoring stage. This is the Recall stage:
 * broad keyword queries → raw candidate list.
 *
 * Design reference: Deli Chen's AutoResearch framework
 * (https://victorchen96.github.io/auto_research/framework.html).
 * The funnel is: Recall → Score (LQS) → Classify (A/B/C/D) → Upgrade.
 * This tool implements ONLY Recall; downstream stages are separate tools.
 *
 * @module @deepseek-ai/dsh-tool-arxiv-search
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-arxiv-search'
export const inject = ['tools', 'systemPrompt']

/**
 * Raw arXiv search result entry. Mirrors the fields exposed by the arXiv API
 * plus a few normalized convenience fields.
 */
export interface ArxivResult {
  /** arXiv identifier, e.g. "2401.02954". */
  arxivId: string
  /** Paper title (whitespace-normalized). */
  title: string
  /** Author list (display strings). */
  authors: string[]
  /** Abstract text. */
  abstract: string
  /** Primary category, e.g. "cs.CL". */
  primaryCategory: string
  /** All categories. */
  categories: string[]
  /** Submission date in YYYY-MM-DDTHH:MM:SSZ form, or empty string if unknown. */
  published: string
  /** arXiv URL. */
  url: string
}

/**
 * Canonical output of the Recall stage. Every downstream stage (Score, Classify,
 * Upgrade) consumes this shape, so it is part of the tool's public contract.
 */
export interface RecallOutput {
  /** How many keyword queries were issued. */
  queryCount: number
  /** Total raw hits across all queries (before dedup). */
  rawHits: number
  /** Deduplicated candidate count. */
  uniqueCount: number
  /** Deduplicated candidates, ready for LQS scoring. */
  results: ArxivResult[]
  /** UI gate stamped by execute() into persisted meta (never part of the canonical value). */
  ui?: { cards: boolean }
}

/**
 * Hit the arXiv API (`http://export.arxiv.org/api/query`) for a single query and
 * parse the Atom XML response into structured entries.
 *
 * arXiv's API returns Atom XML; we parse it with a RegExp-free DOMParser fallback
 * when unavailable, since the code runtime may not expose a full DOM. The parser
 * is deliberately permissive: any entry missing a required field is dropped.
 */
async function queryArxiv(query: string, maxResults: number, signal: AbortSignal): Promise<ArxivResult[]> {
  // Build URL-encoded search query. arXiv accepts:
  //   search_query=all:electron+AND+all:photon
  //   start=0&max_results=20
  const url = 'https://export.arxiv.org/api/query?search_query='
    + encodeURIComponent(query)
    + '&start=0&max_results=' + Math.min(maxResults, 50)
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error('arXiv API returned HTTP ' + res.status + ' for query: ' + query)
  }
  const xml = await res.text()
  return parseAtomEntries(xml)
}

/**
 * Parse arXiv Atom XML entries into ArxivResult[]. Uses a simple tag scan rather
 * than a DOM parser so it works in any runtime; malformed entries are skipped.
 */
function parseAtomEntries(xml: string): ArxivResult[] {
  const results: ArxivResult[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1]
    const id = extractTag(block, 'id')
    // arXiv id is the last path segment of the <id> URL.
    const arxivId = id ? id.split('/abs/').pop() ?? id : ''
    if (!arxivId) continue
    const title = extractTag(block, 'title')?.replace(/\s+/g, ' ').trim() ?? ''
    if (!title) continue
    const authors: string[] = []
    const authorRe = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g
    let am: RegExpExecArray | null
    while ((am = authorRe.exec(block)) !== null) {
      authors.push(am[1].trim())
    }
    const abstract = extractTag(block, 'summary')?.replace(/\s+/g, ' ').trim() ?? ''
    const primaryCategory = extractAttr(block, 'arxiv:primary_category', 'term') ?? ''
    const categories: string[] = []
    const catRe = /<category[^>]*term="([^"]+)"/g
    let cm: RegExpExecArray | null
    while ((cm = catRe.exec(block)) !== null) {
      categories.push(cm[1])
    }
    const published = extractTag(block, 'published') ?? ''
    // Construct a stable arXiv URL.
    const url = 'https://arxiv.org/abs/' + arxivId
    results.push({ arxivId, title, authors, abstract, primaryCategory, categories, published, url })
  }
  return results
}

/** Extract the inner text of the first occurrence of `tag` in `block`. */
function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>')
  const m = re.exec(block)
  return m ? m[1] : undefined
}

/** Extract an attribute from a self-closing or open tag. */
function extractAttr(block: string, tag: string, attr: string): string | undefined {
  const re = new RegExp('<' + tag + '[^>]*' + attr + '="([^"]*)"')
  const m = re.exec(block)
  return m ? m[1] : undefined
}

/** Deduplicate by arXiv id, preserving first occurrence order. */
function dedup(results: ArxivResult[]): ArxivResult[] {
  const seen = new Set<string>()
  const out: ArxivResult[] = []
  for (const r of results) {
    if (seen.has(r.arxivId)) continue
    seen.add(r.arxivId)
    out.push(r)
  }
  return out
}

const TOOL_DESCRIPTION =
  'Search arXiv for research papers by keyword query. This is the RECALL stage of the '
  + 'AutoResearch literature funnel: issue 1-N keyword queries, collect raw hits, and return '
  + 'deduplicated candidates ready for LQS scoring. Each query should follow arXiv search syntax '
  + '(e.g. "all:reinforcement learning AND all:language model"). Pass multiple queries to broaden '
  + 'recall; the tool deduplicates by arXiv id. Use this before lit_score.'

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
const UI_FEATURE = 'literature'

export function apply(ctx: Context, config: Config): void {
  const getUi = (): ResearchUiProbe | undefined =>
    (ctx as { get?: (name: string) => unknown }).get?.('researchUi') as ResearchUiProbe | undefined
  // Effective gate for execute-time stamping: runtime override wins, else own config.
  const gate = (): boolean => getUi()?.getCardEnabled(UI_FEATURE) ?? config.enableCards
  ctx.tools.register(defineTool({
    name: 'arxiv_search',
    description: TOOL_DESCRIPTION,
    parameters: {
      queries: {
        type: 'array',
        required: true,
        description: '1-10 arXiv search queries (arXiv syntax, e.g. "all:self-play AND all:LLM").',
        items: { type: 'string' },
      },
      max_per_query: {
        type: 'number',
        description: 'Maximum results to fetch per query (1-50, default 20).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          queryCount: { type: 'integer', required: true },
          rawHits: { type: 'integer', required: true },
          uniqueCount: { type: 'integer', required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                arxivId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                authors: { type: 'array', items: { type: 'string' }, required: true },
                abstract: { type: 'string', required: true },
                primaryCategory: { type: 'string', required: true },
                categories: { type: 'array', items: { type: 'string' }, required: true },
                published: { type: 'string', required: true },
                url: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: 'arXiv recall: ' + value.queryCount + ' queries → '
          + value.rawHits + ' raw hits → ' + value.uniqueCount + ' unique candidates. '
          + 'Top: ' + value.results.slice(0, 5).map(r => r.arxivId + ' ' + r.title.slice(0, 60)).join('; '),
      }],
      // Project the canonical value as durable UI meta so presentResult can render
      // the structured candidate list on live AND session-log replay alike.
      presentationMeta: (_args, value) => ({ ...value, ui: { cards: gate() } }),
    },
    async execute(args, exec) {
      const queries = args.queries
      if (!queries || queries.length === 0) {
        throw new Error('arxiv_search requires at least one query')
      }
      if (queries.length > 10) {
        throw new Error('arxiv_search accepts at most 10 queries (got ' + queries.length + ')')
      }
      const maxPerQuery = Math.min(Math.max(args.max_per_query ?? 20, 1), 50)
      // Issue queries sequentially with the call signal so a sandbox/host can cancel.
      const all: ArxivResult[] = []
      for (const q of queries) {
        const hits = await queryArxiv(q, maxPerQuery, exec.signal)
        all.push(...hits)
      }
      const unique = dedup(all)
      const output: RecallOutput = {
        queryCount: queries.length,
        rawHits: all.length,
        uniqueCount: unique.length,
        results: unique,
      }
      return output
    },
    // Pending card: what the recall is doing right now, with the queries as raw input.
    presentCall: (args) => {
      if (!config.enableCards) return undefined
      return {
        card: 'generic',
        kind: 'search',
        title: '文献 Recall：检索 ' + args.queries.length + ' 个查询',
        rawInput: args.queries,
      }
    },
    // Completed card: the deduplicated candidate list as a search paths card.
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta as RecallOutput
      if (!v || !Array.isArray(v.results) || typeof v.uniqueCount !== 'number') return undefined
      if (!v.ui || v.ui.cards !== true) return undefined
      return {
        card: 'search',
        shape: 'paths',
        title: 'Recall 完成：' + v.rawHits + ' 条命中 → 去重 ' + v.uniqueCount + ' 篇候选',
        paths: v.results.map(r => r.arxivId + '  ' + r.title),
        truncated: false,
        total: v.uniqueCount,
      }
    },
  }))
}
