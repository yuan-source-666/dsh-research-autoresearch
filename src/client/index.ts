/**
 * Browser half entry, discovered through package.json dsh.client and run by
 * the host's client plugin loader. Registers the card dictionaries, binds a
 * controller to the paired settings section, and injects the card into the
 * plugins tab. The node half owns every behavior; this half only edits the
 * durable layer of the researchUi switch, which the host syncs live.
 */
import { zh, en } from './locales.ts'
import { RESEARCH_UI_NS, ResearchUiCardController } from './card-model.ts'
import type { SettingsScope } from './card-model.ts'
import { ResearchUiCard } from './ResearchUiCard.tsx'

/** The locale namespace the card renders through. */
export const LOCALE_NS = 'dsh-research-autoresearch'
/**
 * Services this half touches through ctx. The browser mounts client plugins
 * with ctx.plugin({ inject, apply }) on a real cordis context: reading any
 * other service (ctx.locale, ctx.slots, ctx.settingsScope) without it listed
 * here throws "cannot get property ... without inject" and the card dies.
 */
export const inject = ['locale', 'settingsScope', 'slots']

/** The browser-context surface this half consumes (host client runtime). */
export interface BrowserCtx {
  effect(fn: () => void, id?: string): void
  locale: { register(ns: string, dicts: { zh: unknown; en: unknown }): void }
  settingsScope: { bind(opts: { namespace: string }): SettingsScope }
  slots: {
    register(meta: { name: string; key: string; locale: string; inject(): unknown }, component: unknown): unknown
    inject(name: string, build: () => unknown): void
  }
}

export function apply(ctx: BrowserCtx): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-research-autoresearch: card dictionaries')
  const card = new ResearchUiCardController(ctx.settingsScope.bind({ namespace: RESEARCH_UI_NS }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: RESEARCH_UI_NS,
    locale: LOCALE_NS,
    inject: () => card.inject(),
  }, ResearchUiCard))
}
