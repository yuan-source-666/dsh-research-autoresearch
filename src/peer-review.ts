/**
 * Multi-persona peer review tool — the "five personas, one honest median"
 * evaluation loop of the AutoResearch framework.
 *
 * Runs 5 independent reviewer personas (each with a different bias) on the
 * provided work artifact, and returns the MEDIAN (not mean) score so a single
 * enthusiastic reviewer cannot inflate it. The framework explicitly uses the
 * median because in practice the most rigorous persona (the theorist) holds
 * the score down — and that signal is the one that matters.
 *
 * The five personas (from Deli Chen's blog post on Paper #4):
 *   R1 Experimentalist  — do the numbers in the paper match the raw experiment logs?
 *   R2 Theorist         — are the proofs rigorous? (binding constraint for most of the paper)
 *   R3 Perfectionist    — table consistency, abstract accuracy, citation hygiene
 *   R4 Synthesizer     — does each addition answer a question the paper itself raised?
 *   R5 Newcomer         — can a non-expert navigate it?
 *
 * The tool itself does NOT do the LLM calls — it accepts the per-persona
 * scores and critiques (typically produced by a subagent per persona), and
 * computes the median and the binding constraint. This separation matches the
 * framework's pattern: scoring is a mechanical step, the LLM work is done by
 * subagents. The orchestrator calls this tool with the 5 scores.
 *
 * @module @deepseek-ai/dsh-tool-peer-review
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-peer-review'
export const inject = ['tools']

/** One reviewer persona's verdict. */
export interface PersonaVerdict {
  /** Persona id: R1..R5. */
  personaId: string
  /** Persona role name. */
  role: string
  /** Numeric score 0-10 (one decimal place). */
  score: number
  /** Three-line critique. */
  critique: string
  /** Whether this persona is the current binding constraint. */
  binding: boolean
}

export interface PeerReviewOutput {
  /** All 5 verdicts. */
  verdicts: PersonaVerdict[]
  /** The median of the 5 scores (the reported score). */
  medianScore: number
  /** Max-minus-min spread of persona scores: judge disagreement intensity. */
  judgeDisagreement: number
  /**
   * Robust uncertainty band on the median: median +/- 1.4826 * MAD (the
   * normal-consistency factor turns MAD into a sigma-equivalent). The 2026
   * LLM-as-judge literature ("Bias and Uncertainty in LLM-as-a-Judge
   * Estimation", conformal ranking work, "Noisy but Valid") is unanimous that
   * a point median without a band over-reports precision.
   */
  scoreBand: [number, number]
  /** The minimum of the 5 scores (the binding constraint). */
  minScore: number
  /** The persona id that produced the minimum score. */
  bindingPersonaId: string
  /** The set of weakness tags across all personas. */
  weaknessTags: string[]
  /** Honest signal: did the score drop from the previous round? */
  scoreDropped: boolean
  /** Previous round score, if known. Omitted from the canonical snapshot when unprovided. */
  previousScore?: number
  /** Suggested next action. */
  nextAction: 'address_binding' | 'address_weaknesses' | 'final_polish' | 'accept'
  /** UI gate stamped by execute() into persisted meta (never part of the canonical value). */
  ui?: { cards: boolean }
}

/** Compute the median of up to 5 numbers. */
function median(scores: number[]): number {
  if (scores.length === 0) return 0
  const sorted = [...scores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const TOOL_DESCRIPTION =
  'Score a research artifact with the 5-persona peer review protocol. Accepts 5 '
  + 'independent reviewer verdicts (each a score 0-10 plus a critique) and computes '
  + 'the MEDIAN (not mean) as the reported score — a single enthusiastic reviewer '
  + 'cannot inflate it. Identifies the binding constraint (the persona with the '
  + 'lowest score, which in practice is the theorist for most of a paper\'s life) '
  + 'and the set of weakness tags. Also signals whether the score dropped from the '
  + 'previous round — the framework\'s V12 case showed that an honest downward '
  + 'revisions (8.5 to 8.2) after external citation checks is more trustworthy '
  + 'than a monotonic climb. Reports judgeDisagreement (score spread) and a robust '
  + 'scoreBand (median +/- 1.4826*MAD): a polarized panel cannot reach accept — '
  + 'severe disagreement auto-tags judge_disagreement (per the 2025-2026 '
  + 'LLM-as-judge uncertainty literature).'

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
  enableCards: z.boolean().default(false),
})

/** Structural probe of the optional researchUi service (tutorial ch.3 optional dependency). */
interface ResearchUiProbe {
  getCardEnabled(feature: string): boolean | undefined
}

/** Which researchUi feature flag gates this tool's cards. */
const UI_FEATURE = 'review'

export function apply(ctx: Context, config: Config): void {
  const getUi = (): ResearchUiProbe | undefined =>
    (ctx as { get?: (name: string) => unknown }).get?.('researchUi') as ResearchUiProbe | undefined
  // Effective gate for execute-time stamping: runtime override wins, else own config.
  const gate = (): boolean => getUi()?.getCardEnabled(UI_FEATURE) ?? config.enableCards
  ctx.tools.register(defineTool({
    name: 'peer_review',
    description: TOOL_DESCRIPTION,
    parameters: {
      verdicts: {
        type: 'array',
        required: true,
        description: '5 reviewer persona verdicts (each: personaId, role, score 0-10, critique, binding).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            personaId: { type: 'string', required: true },
            role: { type: 'string', required: true },
            score: { type: 'number', required: true },
            critique: { type: 'string', required: true },
            binding: { type: 'boolean' },
          },
        },
      },
      weakness_tags: {
        type: 'array',
        description: 'Weakness tags accumulated across all personas (e.g. "missing_proof", "citation_error").',
        items: { type: 'string' },
      },
      previous_score: {
        type: 'number',
        description: 'Previous round median score, for the honest-downward-revision signal.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdicts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                personaId: { type: 'string', required: true },
                role: { type: 'string', required: true },
                score: { type: 'number', required: true },
                critique: { type: 'string', required: true },
                binding: { type: 'boolean', required: true },
              },
            },
          },
          medianScore: { type: 'number', required: true },
        judgeDisagreement: { type: 'number', required: true },
        scoreBand: { type: 'array', items: { type: 'number' }, required: true },
          minScore: { type: 'number', required: true },
          bindingPersonaId: { type: 'string', required: true },
          weaknessTags: { type: 'array', items: { type: 'string' }, required: true },
          scoreDropped: { type: 'boolean', required: true },
          previousScore: { type: 'number' },
          nextAction: {
            type: 'string',
            required: true,
            enum: ['address_binding', 'address_weaknesses', 'final_polish', 'accept'],
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'peer_review: median=' + value.medianScore.toFixed(1)
          + ' (binding: ' + value.bindingPersonaId + ' at ' + value.minScore.toFixed(1) + ')'
          + (value.scoreDropped ? ' [DROPPED from ' + (value.previousScore ?? 0).toFixed(1) + ' — honest revision]' : '')
          + ', next: ' + value.nextAction
          + ', weaknesses: ' + value.weaknessTags.join(', '),
      }],
      presentationMeta: (_args, value) => ({ ...value, ui: { cards: gate() } }),
    },
    execute(args) {
      const verdicts = args.verdicts
      if (!verdicts || verdicts.length < 1) {
        throw new Error('peer_review requires at least one verdict')
      }
      if (verdicts.length > 5) {
        throw new Error('peer_review accepts at most 5 verdicts (got ' + verdicts.length + ')')
      }
      // Validate scores.
      for (const v of verdicts) {
        if (v.score < 0 || v.score > 10) {
          throw new Error('peer_review score out of range [0,10]: ' + v.score + ' from ' + v.personaId)
        }
      }
      const scores = verdicts.map(v => v.score)
      const medianScore = median(scores)
      const minScore = Math.min(...scores)
      // Judge-uncertainty statistics (scale-preserving, purely arithmetic).
      const judgeDisagreement = Math.max(...scores) - Math.min(...scores)
      const mad = median(scores.map(s => Math.abs(s - medianScore)))
      const scoreBand: [number, number] = [
        Math.max(0, Math.round((medianScore - 1.4826 * mad) * 100) / 100),
        Math.min(10, Math.round((medianScore + 1.4826 * mad) * 100) / 100),
      ]
      const bindingPersona = verdicts.find(v => v.score === minScore)
      const bindingPersonaId = bindingPersona?.personaId ?? verdicts[0].personaId
      // Mark the binding persona.
      const markedVerdicts: PersonaVerdict[] = verdicts.map(v => ({
        ...v,
        binding: v.personaId === bindingPersonaId,
      }))
      const previousScore = args.previous_score
      const scoreDropped = typeof previousScore === 'number' && medianScore < previousScore
      // Severe panel disagreement (spread >= 4 on the 0-10 scale) is itself a
      // weakness signal — a high median from a polarized panel must not reach
      // 'accept' before the judges converge (Breaking-the-Reviewer /
      // cross-model-auditing findings).
      const weakList = [...(args.weakness_tags ?? [])]
      if (judgeDisagreement >= 4 && !weakList.includes('judge_disagreement')) {
        weakList.push('judge_disagreement')
      }
      const weaknessTags = weakList

      // Determine next action.
      let nextAction: PeerReviewOutput['nextAction']
      // Accept requires convergence as well as height: an 8.5+ median only
      // accepts when no persona is severe (min>=7 handled below) and the panel
      // agrees (disagreement gate injected as judge_disagreement weakness).
      if (medianScore >= 8.5 && weaknessTags.length === 0) {
        nextAction = 'accept'
      } else if (judgeDisagreement >= 4 && medianScore >= 8.5) {
        nextAction = 'address_weaknesses'
      } else if (minScore < 7.0) {
        nextAction = 'address_binding'
      } else if (weaknessTags.length > 3) {
        nextAction = 'address_weaknesses'
      } else if (medianScore >= 8.0) {
        nextAction = 'final_polish'
      } else {
        nextAction = 'address_binding'
      }

      const output: PeerReviewOutput = {
        verdicts: markedVerdicts,
        medianScore,
        judgeDisagreement,
        scoreBand,
        minScore,
        bindingPersonaId,
        weaknessTags,
        scoreDropped,
        // Lossless-JSON contract: an absent previous_score omits the key.
      ...(typeof previousScore === 'number' ? { previousScore } : {}),
        nextAction,
      }
      return output
    },
    presentCall: (args) => {
      if (!config.enableCards) return undefined
      return {
        card: 'generic',
        kind: 'other',
        title: '五人格同行评审（' + args.verdicts.length + ' 份裁决）',
      }
    },
    // Completed card: the five-persona scoreboard with the median (not mean) as
    // headline, the binding constraint flagged, and the honest-revision badge.
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta as PeerReviewOutput
      if (!v || !Array.isArray(v.verdicts)) return undefined
      if (!v.ui || v.ui.cards !== true) return undefined
      const lines = v.verdicts.map(verdict =>
        verdict.personaId + ' ' + verdict.role + '：' + verdict.score.toFixed(1)
        + (verdict.binding ? '  ← 约束瓶颈' : ''))
      if (v.weaknessTags.length) lines.push('弱点标签：' + v.weaknessTags.join(', '))
      lines.push('下一步：' + v.nextAction)
      const dropped = v.scoreDropped
        ? ' · 自 ' + (v.previousScore ?? 0).toFixed(1) + ' 下调（诚实修订）'
        : ''
      return {
        card: 'generic',
        title: '⭐ 评审中位数 ' + v.medianScore.toFixed(1) + ' · 瓶颈 ' + v.bindingPersonaId + dropped,
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  }))
}
