/**
 * The research-ui card model: a React-free controller that stages drafts
 * over the paired 'research-ui' settings section and writes them on save.
 * Reads resolve through the settings layers (user over composition over the
 * schema default); a field present in the raw user layer marks overridden.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The paired host settings namespace, spelled exactly as the host brands it. */
export const RESEARCH_UI_NS = 'research-ui'

/** Every durable field the card exposes, in display order. */
export const FIELDS = ['defaultCards', 'literatureCards', 'scoringCards', 'panelCards', 'guardianCards', 'reviewCards'] as const
export type Field = (typeof FIELDS)[number]

export interface SwitchState {
  value: boolean
  overridden: boolean
}

export interface CardSnapshot {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  switches: Record<Field, SwitchState>
}

/** The slice of the bound settings scope the controller consumes. */
export interface SettingsScope {
  subscribe(fn: () => void): () => void
  getSnapshot(): { user?: Record<string, unknown> | null; value?: Record<string, unknown> | null; base?: Record<string, unknown> | null; writable?: boolean }
  set(field: string, value: boolean): Promise<void>
}

/** The actions + store seat the slot registration injects into the face. */
export interface CardFace {
  hooks: { researchUi: { get(): CardSnapshot; set(value: CardSnapshot): void } }
  toggle(field: Field, value: boolean): void
  save(): Promise<void>
  discard(): void
}

export class ResearchUiCardController {
  private readonly staged = new Map<Field, boolean>()
  private saving = false
  private failed = false
  /** The card's snapshot store; passed to slots.register as the store seat. */
  readonly store: CardFace['hooks']['researchUi']

  /** @param scope - the bound settings scope for the research-ui namespace. */
  constructor(private readonly scope: SettingsScope) {
    this.store = createSnapshotStore<CardSnapshot>(this.project())
    scope.subscribe(() => this.publish())
  }

  /** Build the face the card's slot registration injects. */
  inject(): CardFace {
    return {
      hooks: { researchUi: this.store },
      toggle: (field, value) => this.stage(field, value),
      save: () => this.save(),
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  private stage(field: Field, value: boolean): void {
    this.staged.set(field, Boolean(value))
    this.failed = false
    this.publish()
  }

  /** Write every staged draft through the scope, in staging order. */
  async save(): Promise<void> {
    if (this.saving || this.staged.size === 0) return
    this.saving = true
    this.failed = false
    this.publish()
    const writes: Promise<void>[] = []
    for (const [field, value] of this.staged) writes.push(this.scope.set(field, value))
    try {
      await Promise.all(writes)
      this.staged.clear()
    } catch {
      // Keep the drafts: a save that did not land must not throw away what
      // the user toggled; the next edit or save retries from the same state.
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  private user(): Record<string, unknown> {
    return this.scope.getSnapshot().user ?? {}
  }

  switchState(field: Field): SwitchState {
    if (this.staged.has(field)) {
      return { value: this.staged.get(field) as boolean, overridden: true }
    }
    const resolved = (this.scope.getSnapshot().value ?? {}) as Record<string, unknown>
    return { value: Boolean(resolved[field]), overridden: Object.hasOwn(this.user(), field) }
  }

  /** The full face snapshot: layers resolved, drafts previewed, flags fresh. */
  project(): CardSnapshot {
    const snapshot = this.scope.getSnapshot()
    const switches = {} as Record<Field, SwitchState>
    for (const f of FIELDS) switches[f] = this.switchState(f)
    return {
      available: true,
      writable: snapshot.writable !== false,
      dirty: this.staged.size > 0,
      saving: this.saving,
      failed: this.failed,
      switches,
    }
  }

  publish(): void {
    this.store.set(this.project())
  }
}
