/**
 * Research UI feature-switch plugin — visualization control plane for the
 * AutoResearch tool suite, mirroring two production precedents:
 *
 * 1. DECLARATIVE injection: each research tool's own Config.enableCards
 *    (default false) decides the deployment resting state, exactly like
 *    tool-bash's enableRunInBackground gating.
 * 2. RUNTIME switch: this plugin registers the optional `researchUi`
 *    service (tutorial ch.3 Service form) with tri-state per-feature
 *    overrides (true / false / follow-config). Tools probe it via ctx.get,
 *    so every tool stays independently mountable WITHOUT this plugin.
 *
 * Replay-safety rule respected: tool presenters never read the live flag at
 * presentation time — execute() stamps the effective gate into
 * output.presentationMeta (persisted with the tool/result event) and
 * presentResult narrows it back; the pending view stays config-gated. Same
 * log renders the same card forever, whichever way the switch moved since.
 *
 * The host half also registers a 'research-ui' settings namespace via
 * installSettingsSection (cookbook/adding-a-settings-card): deployments with
 * the Web settings provider pair a browser card to it; headless assemblies
 * treat it as an inert registration.
 *
 * @module @deepseek-ai/dsh-tool-research-ui
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'tool-research-ui'
export const inject = ['tools']

/** The visualization features that can be toggled independently. */
export const FEATURES = ['literature', 'scoring', 'panel', 'guardian', 'review'] as const
export type Feature = typeof FEATURES[number]
export type TriState = 'on' | 'off' | 'follow'

export const FEATURE_LABELS: Record<Feature, string> = {
  literature: '📚 文献检索卡 (arxiv_search)',
  scoring: '📊 LQS 评分卡 (lit_score)',
  panel: '🧪 研究进度面板 (research_state)',
  guardian: '🧭 停滞检测卡 (stall_check)',
  review: '⭐ 评审记分卡 (peer_review)',
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    researchUi: ResearchUiService
  }
}

/**
 * Tri-state flag registry: true = force cards on regardless of tool config,
 * false = force off, absent = follow the tool's own enableCards config.
 */
export class ResearchUiService extends Service {
  private overrides = new Map<Feature, boolean>()

  constructor(ctx: Context) {
    super(ctx, 'researchUi')
  }

  /** boolean = override; undefined = the tool should follow its own config. */
  getCardEnabled(feature: Feature): boolean | undefined {
    return this.overrides.get(feature)
  }

  /** null clears the override (return to follow-config). */
  setCardEnabled(feature: Feature, value: boolean | null): void {
    if (value === null) this.overrides.delete(feature)
    else this.overrides.set(feature, value)
  }

  setBulk(value: boolean | null): void {
    for (const f of FEATURES) this.setCardEnabled(f, value)
  }

  triState(): Record<Feature, TriState> {
    const out = {} as Record<Feature, TriState>
    for (const f of FEATURES) {
      const v = this.overrides.get(f)
      out[f] = v === true ? 'on' : v === false ? 'off' : 'follow'
    }
    return out
  }
}

/** Settings schema: the Web settings card pairs by namespace and edits it. */
export interface Config {
  /** Master gate: when true, force ALL five card features ON regardless of tools. */
  defaultCards: boolean
  /** Force the arxiv_search recall cards ON (false = follow tool config). */
  literatureCards: boolean
  /** Force the lit_score scoreboard cards ON. */
  scoringCards: boolean
  /** Force the research_state progress panel ON. */
  panelCards: boolean
  /** Force the stall_check traffic-light card ON. */
  guardianCards: boolean
  /** Force the peer_review scoreboard card ON. */
  reviewCards: boolean
}

export const Config: z<Config> = z.object({
  defaultCards: z.boolean().default(true),
  literatureCards: z.boolean().default(false),
  scoringCards: z.boolean().default(false),
  panelCards: z.boolean().default(false),
  guardianCards: z.boolean().default(false),
  reviewCards: z.boolean().default(false),
})

/** Which service feature each persisted settings field drives. */
export const FIELD_TO_FEATURE: Record<string, Feature> = {
  literatureCards: 'literature',
  scoringCards: 'scoring',
  panelCards: 'panel',
  guardianCards: 'guardian',
  reviewCards: 'review',
}

export const RESEARCH_UI_NS = settingsNamespace('research-ui')

function flagLabel(v: TriState): string {
  return v === 'on' ? '🟢 开（运行时注入）' : v === 'off' ? '🔴 关（运行时关闭）' : '⚪ 跟随工具配置'
}

export function apply(ctx: Context, config: Config): void {
  const ui = new ResearchUiService(ctx)
  if (config.defaultCards) ui.setBulk(true)

  // Registering the namespace is what lets the Web 'plugin config' tab pair
  // a browser card to this host half; changing it re-seeds the master here.
  // Handler shape follows the cookbook: keep the section's live source getter,
  // rebuild derived state on change.
  let settingsSource: (() => Config) | undefined
  const syncFromSettings = (): void => {
    const value = settingsSource ? settingsSource() : config
    // A field ON persists an override; a field OFF returns to follow-config.
    for (const field of Object.keys(FIELD_TO_FEATURE)) {
      ui.setCardEnabled(FIELD_TO_FEATURE[field], value[field as keyof Config] ? true : null)
    }
    if (value.defaultCards) ui.setBulk(true)
  }
  installSettingsSection(ctx, RESEARCH_UI_NS, Config, config, {
    setSource: (current: () => Config) => { settingsSource = current },
    onChange: syncFromSettings,
  })
  syncFromSettings()

  ctx.tools.register(defineTool({
    name: 'research_ui_switch',
    description:
      'Toggle the AutoResearch visualization layer at runtime (inject when needed, drop when not). '
      + 'Features: literature (recall list cards), scoring (LQS scoreboard), panel (research progress '
      + 'panel), guardian (stall traffic-light), review (persona scoreboard). action=on injects the '
      + 'cards from the very next call, off falls back to the generic view, reset returns control to '
      + "each tool's own enableCards config. feature=all applies to every feature. Runtime state is "
      + 'session-scoped; the result card stamped per call keeps session-log replay stable.',
    parameters: {
      feature: {
        type: 'string',
        required: true,
        enum: [...FEATURES, 'all'],
        description: 'Which visualization feature to control (or all five).',
      },
      action: {
        type: 'string',
        required: true,
        enum: ['on', 'off', 'reset'],
        description: 'on = force cards, off = force generic fallback, reset = follow deployment config.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          feature: { type: 'string', required: true },
          action: { type: 'string', required: true },
          flags: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              literature: { type: 'string', required: true, enum: ['on', 'off', 'follow'] },
              scoring: { type: 'string', required: true, enum: ['on', 'off', 'follow'] },
              panel: { type: 'string', required: true, enum: ['on', 'off', 'follow'] },
              guardian: { type: 'string', required: true, enum: ['on', 'off', 'follow'] },
              review: { type: 'string', required: true, enum: ['on', 'off', 'follow'] },
            },
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'research_ui_switch ' + args.feature + ' -> ' + args.action + '; now: ' + JSON.stringify(value.flags) + ' (' + value.summary + ')',
      }],
      // Identity projection: the control panel is ungated (it IS the switch),
      // so the canonical value doubles as the durable presentation meta.
      presentationMeta: (_args, value) => value,
    },
    execute(args) {
      const targets: readonly Feature[] = args.feature === 'all'
        ? FEATURES
        : [args.feature as Feature]
      for (const t of targets) {
        ui.setCardEnabled(t, args.action === 'on' ? true : args.action === 'off' ? false : null)
      }
      const flags = ui.triState()
      const on = FEATURES.filter(f => flags[f] === 'on').length
      const off = FEATURES.filter(f => flags[f] === 'off').length
      return {
        feature: args.feature,
        action: args.action,
        flags,
        summary: on + ' forced-on / ' + off + ' forced-off / ' + (FEATURES.length - on - off) + ' follow-config',
      }
    },
    // The control panel renders unconditionally — it IS the switch.
    presentCall: (args) => ({
      card: 'generic',
      kind: 'other',
      title: '🎛️ 可视化开关：' + (args.feature as string) + ' → ' + (args.action as string),
      rawInput: { feature: args.feature, action: args.action },
    }),
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta as { flags?: Record<Feature, TriState>; summary?: string } | undefined
      if (!v || !v.flags || typeof v.flags !== 'object' || !FEATURES.every(f => typeof v.flags[f] === 'string')) return undefined
      const lines = FEATURES.map(f => FEATURE_LABELS[f] + '：' + flagLabel(v.flags[f]))
      if (typeof v.summary === 'string') lines.push(v.summary)
      return {
        card: 'generic',
        title: '🎛️ 科研可视化总控台 · ' + FEATURES.filter(f => v.flags[f] === 'on').length + '/5 开',
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  }))
}
