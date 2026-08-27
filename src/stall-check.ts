/**
 * Stall detection and direction-diversity tool — the cognitive loop and stalling
 * failure modes of the AutoResearch framework.
 *
 * Reads directions_tried.json and progress.json from a task's state/ directory,
 * computes:
 *   1. stale_count — incremented on iterations with 0 new findings or a metric drop.
 *   2. forced pivot — stale_count >= 2 → change a structural constraint (not tactics).
 *   3. direction diversity — a new direction must differ from every tried one.
 *   4. round cap — a single work session caps at 15 rounds or 30 minutes.
 *
 * Returns a structured recommendation: continue, pivot (with a suggested
 * perturbation strategy), or escalate (flag for human attention).
 *
 * Design references:
 * - Deli Chen's AutoResearch framework
 *   (https://victorchen96.github.io/auto_research/framework.html#5-stall-detection--pivoting)
 * - The "Pivot structure, not tactics" rule.
 *
 * @module @deepseek-ai/dsh-tool-stall-check
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'tool-stall-check'
export const inject = ['tools']

export interface StallCheckOutput {
  /** Current stale_count from progress.json. */
  staleCount: number
  /** Whether a forced pivot is triggered (stale_count >= 2). */
  pivotNeeded: boolean
  /** Whether escalation to human is needed (stale_count >= 4). */
  escalate: boolean
  /** Whether the proposed direction is novel (differs from all tried). */
  directionNovel: boolean
  /** Round cap status: rounds used / cap. */
  roundsUsed: number
  roundsCap: number
  /** Wall-clock minutes elapsed / cap. */
  minutesElapsed: number
  minutesCap: number
  /** A structured recommendation string. */
  recommendation: 'continue' | 'pivot' | 'escalate' | 'cap_exceeded'
  /** Suggested perturbation strategy when pivot is needed. Omitted when not pivoting. */
  perturbationStrategy?: string
  /** Tried direction labels for the diversity check. */
  triedDirections: string[]
  /** UI gate stamped by execute() into persisted meta (never part of the canonical value). */
  ui?: { cards: boolean }
}

/** The standard perturbation strategies, in the order the framework uses them. */
const PERTURBATION_STRATEGIES: string[] = [
  'Start from the opposite hypothesis — assume the claim is false and search for counter-evidence.',
  'Find structurally similar cross-domain cases — map the problem to a different field and borrow its solution.',
  'Change the evaluation metric — what does progress look like under a different lens?',
  'Change the data slice — restrict to a subset where the hypothesis is strongest or weakest.',
  'Change the granularity — go from instance-level to group-level, or vice versa.',
  'Change the environment — what structural constraint (not tactical parameter) is wrong?',
]

/**
 * Check whether a proposed direction label differs from every tried direction.
 * "Differs" means the label is not a substring of any tried label and vice versa.
 */
function isDirectionNovel(label: string, tried: string[]): boolean {
  if (tried.length === 0) return true
  const lower = label.toLowerCase()
  for (const t of tried) {
    const lt = t.toLowerCase()
    if (lt.includes(lower) || lower.includes(lt)) return false
  }
  return true
}

const ROUNDS_CAP = 15
const MINUTES_CAP = 30

const TOOL_DESCRIPTION =
  'Detect stalling and enforce direction diversity for an AutoResearch task. '
  + 'Reads progress.json and directions_tried.json from the task state directory, '
  + 'checks stale_count, and recommends one of: continue, pivot (structural, not '
  + 'tactical), escalate (human attention), or cap_exceeded. The rule is '
  + '"pivot structure, not tactics" — when a task stalls repeatedly within a frame, '
  + 'the decisive gain usually comes from correcting the environment/structural '
  + 'constraint, not from tuning strategy parameters harder. Round cap: 15 rounds '
  + 'or 30 minutes per session.'

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
const UI_FEATURE = 'guardian'

export function apply(ctx: Context, config: Config): void {
  const getUi = (): ResearchUiProbe | undefined =>
    (ctx as { get?: (name: string) => unknown }).get?.('researchUi') as ResearchUiProbe | undefined
  // Effective gate for execute-time stamping: runtime override wins, else own config.
  const gate = (): boolean => getUi()?.getCardEnabled(UI_FEATURE) ?? config.enableCards
  ctx.tools.register(defineTool({
    name: 'stall_check',
    description: TOOL_DESCRIPTION,
    parameters: {
      task_dir: {
        type: 'string',
        required: true,
        description: 'Absolute path to the task directory (containing state/ and logs/).',
      },
      proposed_direction: {
        type: 'string',
        required: true,
        description: 'Short label for the direction the agent is about to try.',
      },
      new_findings_this_iteration: {
        type: 'integer',
        required: true,
        description: 'Number of new findings produced in the current iteration (0 or a drop triggers stale_count++).',
      },
      previous_metric: {
        type: 'number',
        description: 'Previous iteration metric (e.g. review score). If current metric is lower, trigger stall.',
      },
      current_metric: {
        type: 'number',
        description: 'Current iteration metric for the drop check.',
      },
      session_started_at: {
        type: 'string',
        required: true,
        description: 'ISO timestamp when the current work session started (for the wall-clock cap).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          staleCount: { type: 'integer', required: true },
          pivotNeeded: { type: 'boolean', required: true },
          escalate: { type: 'boolean', required: true },
          directionNovel: { type: 'boolean', required: true },
          roundsUsed: { type: 'integer', required: true },
          roundsCap: { type: 'integer', required: true },
          minutesElapsed: { type: 'number', required: true },
          minutesCap: { type: 'integer', required: true },
          recommendation: {
            type: 'string',
            required: true,
            enum: ['continue', 'pivot', 'escalate', 'cap_exceeded'],
          },
          perturbationStrategy: { type: 'string' },
          triedDirections: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'stall_check: stale=' + value.staleCount
          + ', novel=' + value.directionNovel
          + ', recommendation=' + value.recommendation
          + (value.perturbationStrategy ? ', strategy: ' + value.perturbationStrategy : '')
          + ' (rounds ' + value.roundsUsed + '/' + value.roundsCap
          + ', ' + value.minutesElapsed.toFixed(1) + 'min/' + value.minutesCap + 'min)',
      }],
      presentationMeta: (_args, value) => ({ ...value, ui: { cards: gate() } }),
    },
    async execute(args) {
      // Input hygiene: the direction label is persisted to directions_tried.json,
      // and an unparseable session_started_at poisons every time-cap comparison
      // with NaN. Fail fast with a clear message instead.
      if (typeof args.proposed_direction !== 'string' || args.proposed_direction.trim().length === 0) {
        throw new Error('stall_check: proposed_direction must be a non-empty label (it is persisted to directions_tried.json)')
      }
      if (!Number.isFinite(Date.parse(args.session_started_at))) {
        throw new Error('stall_check: session_started_at must be a parseable ISO timestamp (e.g. new Date().toISOString())')
      }
      const taskDir = args.task_dir
      const stateDir = join(taskDir, 'state')
      // Read progress.json (best-effort; absent is treated as initial).
      let progress: { iteration?: number; staleCount?: number; totalFindings?: number } = {}
      try {
        progress = JSON.parse(await fs.readFile(join(stateDir, 'progress.json'), 'utf8'))
      } catch { /* absent — initial state */ }
      // Read directions_tried.json (jsonl).
      let directions: { label: string; outcome: string }[] = []
      try {
        const content = await fs.readFile(join(stateDir, 'directions_tried.json'), 'utf8')
        directions = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
      } catch { /* absent */ }

      const staleCount = progress.staleCount ?? 0
      // Compute the delta: did this iteration stall?
      const newFindings = args.new_findings_this_iteration
      const metricDrop = args.previous_metric !== undefined && args.current_metric !== undefined
        && args.current_metric < args.previous_metric
      const iterationStalled = newFindings === 0 || metricDrop
      const newStaleCount = iterationStalled ? staleCount + 1 : Math.max(0, staleCount - 1)

      const pivotNeeded = newStaleCount >= 2
      const escalate = newStaleCount >= 4
      const directionNovel = isDirectionNovel(args.proposed_direction, directions.map(d => d.label))
      const roundsUsed = progress.iteration ?? 0
      const minutesElapsed = (Date.now() - Date.parse(args.session_started_at)) / 60000
      const minutesCap = MINUTES_CAP
      let recommendation: 'continue' | 'pivot' | 'escalate' | 'cap_exceeded'
      if (roundsUsed >= ROUNDS_CAP || minutesElapsed >= MINUTES_CAP) {
        recommendation = 'cap_exceeded'
      } else if (escalate) {
        recommendation = 'escalate'
      } else if (pivotNeeded || !directionNovel) {
        recommendation = 'pivot'
      } else {
        recommendation = 'continue'
      }
      // Pick a perturbation strategy deterministically based on stale count,
      // so consecutive pivots cycle through different strategies.
      const strategyIdx = Math.min(newStaleCount - 2, PERTURBATION_STRATEGIES.length - 1)
      const perturbationStrategy = pivotNeeded
        ? PERTURBATION_STRATEGIES[Math.max(0, strategyIdx)]
        : undefined

      const output: StallCheckOutput = {
        staleCount: newStaleCount,
        pivotNeeded,
        escalate,
        directionNovel,
        roundsUsed,
        roundsCap: ROUNDS_CAP,
        minutesElapsed,
        minutesCap: MINUTES_CAP,
        recommendation,
        // Omit the key entirely when absent: the registry requires lossless
        // JSON, and an undefined-valued member is a lossy serialization.
        ...(perturbationStrategy !== undefined ? { perturbationStrategy } : {}),
        triedDirections: directions.map(d => d.label),
      }
      return output
    },
    presentCall: (args) => {
      if (!config.enableCards) return undefined
      return {
        card: 'generic',
        kind: 'other',
        title: '停滞检测：' + args.proposed_direction,
      }
    },
    // Completed card: the anti-cognitive-loop verdict with its traffic-light badge.
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta as StallCheckOutput
      if (!v || typeof v.staleCount !== 'number' || !['continue', 'pivot', 'escalate', 'cap_exceeded'].includes(v.recommendation)) return undefined
      if (!v.ui || v.ui.cards !== true) return undefined
      const badge = {
        continue: '🟢 继续推进',
        pivot: '🔄 结构性转向',
        escalate: '🔴 需人工介入',
        cap_exceeded: '⛔ 会话已达上限',
      }[v.recommendation]
      const lines = [
        '建议：' + badge,
        '停滞计数：' + v.staleCount + '（≥2 转向，≥4 升级）',
        '方向新颖：' + (v.directionNovel ? '是' : '否 — 已尝试过相似方向'),
        '轮次：' + v.roundsUsed + ' / ' + v.roundsCap,
        '用时：' + v.minutesElapsed.toFixed(1) + ' / ' + v.minutesCap + ' 分钟',
      ]
      if (v.perturbationStrategy) lines.push('转向策略：' + v.perturbationStrategy)
      if (v.triedDirections.length) lines.push('已试方向：' + v.triedDirections.join(' | '))
      return {
        card: 'generic',
        title: '🧭 停滞检测 · ' + badge,
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  }))
}
