/**
 * Card copy for the research visualization control, in both shipped locales.
 * The namespace is registered into the client locale service by the browser
 * half; the slot entry declares it, so the renderer binds t for these keys.
 */
export interface CardLocale {
  title: string
  description: string
  master: string
  literature: string
  scoring: string
  panel: string
  guardian: string
  review: string
  overridden: string
  save: string
  discard: string
  unsaved: string
  saving: string
  readOnly: string
  saveFailed: string
}

export const zh: CardLocale = {
  title: '科研可视化总控台',
  description: 'AutoResearch 五张进度卡的持久开关。开＝强制注入；关＝跟随各工具部署配置。会话内的临时开合请用 research_ui_switch 工具。',
  master: '总闸：全部强制开',
  literature: '📚 文献检索卡 (arxiv_search)',
  scoring: '📊 LQS 评分卡 (lit_score)',
  panel: '🧪 研究进度面板 (research_state)',
  guardian: '🧭 停滞检测卡 (stall_check)',
  review: '⭐ 评审记分卡 (peer_review)',
  overridden: '持久覆盖',
  save: '保存',
  discard: '放弃修改',
  unsaved: '未保存',
  saving: '保存中…',
  readOnly: '当前文档为只读，无法保存。',
  saveFailed: '上次保存未被接受，请修正后重试。',
}

export const en: CardLocale = {
  title: 'Research Visualization Control',
  description: 'Durable switches for the five AutoResearch progress cards. On forces the cards; off follows each tool\u2019s deployment config. For per-session flips use the research_ui_switch tool.',
  master: 'Master: force all on',
  literature: '📚 Literature recall cards (arxiv_search)',
  scoring: '📊 LQS scoreboard (lit_score)',
  panel: '🧪 Research progress panel (research_state)',
  guardian: '🧭 Stall traffic-light (stall_check)',
  review: '⭐ Review scoreboard (peer_review)',
  overridden: 'durable override',
  save: 'Save',
  discard: 'Discard',
  unsaved: 'unsaved',
  saving: 'saving…',
  readOnly: 'The current document is read-only.',
  saveFailed: 'The last save was refused; fix and retry.',
}
