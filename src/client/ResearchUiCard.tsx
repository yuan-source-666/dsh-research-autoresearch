/**
 * The research-ui card face: a collapsed header (title + unsaved badge) that
 * expands to six durable switches and a save/discard footer. Plain React
 * with the host's design tokens — CSS modules are build-pipeline territory
 * this dependency-free bundle deliberately stays out of.
 */
import { useState } from 'react'
import type { CardSnapshot, Field } from './card-model.ts'

export interface ResearchUiCardProps {
  t(key: string): string
  useResearchUi(selector: (snapshot: CardSnapshot) => CardSnapshot): CardSnapshot
  toggle(field: Field, value: boolean): void
  save(): void
  discard(): void
}

// Styles mirror the official card sheet, built from host design tokens.
const cardStyle: Record<string, unknown> = { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-3)', transition: 'border-color .16s, background .16s' }
const cardOpenStyle: Record<string, unknown> = { ...cardStyle, background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)' }
const headerStyle: Record<string, unknown> = { width: '100%', appearance: 'none', border: '0', background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderRadius: '12px' }
const headTextStyle: Record<string, unknown> = { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' }
const nameStyle: Record<string, unknown> = { fontSize: '15px', fontWeight: 600, lineHeight: '1.4', color: 'var(--dsw-alias-label-primary)' }
const descStyle: Record<string, unknown> = { fontSize: '13px', lineHeight: '1.5', color: 'var(--dsw-alias-label-tertiary)' }
const pendingStyle: Record<string, unknown> = { flex: 'none', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', lineHeight: '17px', background: 'var(--dsw-alias-bg-layer-4)', color: 'var(--dsw-alias-label-secondary)' }
const chevronStyle: Record<string, unknown> = { flex: 'none', transform: 'none', transition: 'transform .15s', fontSize: '12px' }
const bodyStyle: Record<string, unknown> = { padding: '2px 16px 14px', display: 'flex', flexDirection: 'column', gap: '2px' }
const rowStyle: Record<string, unknown> = { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' }
const rowLabelStyle: Record<string, unknown> = { flex: '1', minWidth: '0', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' }
const badgeStyle: Record<string, unknown> = { marginLeft: '8px', fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '4px', padding: '0 4px' }
const footerStyle: Record<string, unknown> = { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', paddingTop: '10px' }
const btnStyle: Record<string, unknown> = { appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-3)', color: 'inherit', font: 'inherit', fontSize: '13px', padding: '4px 12px', cursor: 'pointer' }
const btnPrimaryStyle: Record<string, unknown> = { ...btnStyle, background: 'var(--dsw-alias-accent, #4f6ef7)', color: '#fff', border: '0' }
const failStyle: Record<string, unknown> = { flex: '1', fontSize: '12px', color: '#e5484d' }

/** Each switch row: the settings field written and the locale key rendered. */
const ROWS: ReadonlyArray<readonly [Field, string]> = [
  ['defaultCards', 'master'],
  ['literatureCards', 'literature'],
  ['scoringCards', 'scoring'],
  ['panelCards', 'panel'],
  ['guardianCards', 'guardian'],
  ['reviewCards', 'review'],
]

export function ResearchUiCard(props: ResearchUiCardProps) {
  const s = props.useResearchUi((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!s || !s.available) return null
  const { t } = props
  const disabled = !s.writable || s.saving
  return (
    <li style={open ? cardOpenStyle : cardStyle}>
      <button type="button" style={headerStyle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={headTextStyle}>
          <span style={nameStyle}>{t('title')}</span>
          <span style={descStyle}>{t('description')}</span>
        </span>
        {s.dirty ? <span style={pendingStyle}>{t('unsaved')}</span> : null}
        <span aria-hidden style={open ? { ...chevronStyle, transform: 'rotate(90deg)' } : chevronStyle}>▸</span>
      </button>
      {open ? (
        <div style={bodyStyle}>
          {ROWS.map(([field, label]) => (
            <label key={field} style={rowStyle}>
              <span style={rowLabelStyle}>
                {t(label)}
                {s.switches[field].overridden ? <span style={badgeStyle}>{t('overridden')}</span> : null}
              </span>
              <input
                type="checkbox"
                checked={s.switches[field].value}
                disabled={disabled}
                onChange={(e: unknown) => props.toggle(field, (e as { target: { checked: boolean } }).target.checked)}
              />
            </label>
          ))}
          {s.dirty || s.saving || s.failed ? (
            <div style={footerStyle}>
              <span style={failStyle}>{s.failed ? t('saveFailed') : ' '}</span>
              <button type="button" style={btnStyle} disabled={s.saving} onClick={() => props.discard()}>{t('discard')}</button>
              <button type="button" style={btnPrimaryStyle} disabled={disabled || !s.dirty} onClick={() => props.save()}>{s.saving ? t('saving') : t('save')}</button>
            </div>
          ) : null}
          {!s.writable ? <div style={descStyle}>{t('readOnly')}</div> : null}
        </div>
      ) : null}
    </li>
  )
}
