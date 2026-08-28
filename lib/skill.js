/**
 * autoresearch — the missing half of the AutoResearch framework.
 *
 * The framework ships as a SKILL.md protocol that teaches an agent to run the
 * research loop; the six tools in this bundle implement the protocol's
 * mechanics, but mechanics without orchestration sit unused (measured: zero
 * calls across 83 host sessions after install). This module registers the
 * protocol as a RUNTIME skill via ctx.skills.register(), so the model-facing
 * catalog advertises 'autoresearch' and the full loop is loaded on demand.
 *
 * Registration is OPTIONAL and defensive on purpose:
 *  - we look the service up with ctx.get('skills') instead of adding
 *    'skills' to the module-level inject, because a profile without the
 *    skills subsystem must still boot this bundle exactly as before
 *    (inject-gated services that never arrive = pending entry = brick,
 *    see postmortem 0001 and this project's own restart incident);
 *  - every failure path is contained: a throw from register() logs and the
 *    tools keep working.
 */
                                                  

/** Minimal structural view of @deepseek-ai/dsh-skill's runtime registration. */
                          
                   
                
                       
                      
                  
                   
                
 

export const SKILL_NAME = 'autoresearch'

const SKILL_BODY = `# AutoResearch 科研协议（DSH 工具编排）

你正在执行长程自主科研任务。本技能规定六件套工具的编排循环；协议原文见 Deli Chen 的 AutoResearch 框架（https://victorchen96.github.io/auto_research/framework.html）。

## 铁律（行为约束）

1. **零交互**：科研循环内不得向用户提问；所有决策依据状态文件。
2. **就绪即执行**：不等待确认，不做"要不要继续"式收尾。
3. **一切落盘**：每轮迭代结束前，findings / directions / iteration_log / progress 必须已通过 research_state 写入；你的记忆不是持久层。
4. **诚实评分**：外部证据（引用核查、实验失败）使论文质量下降时如实降分，禁止单调爬分。

## 任务目录约定

为任务建立 <task_dir>（绝对路径），内含：
- state/task_spec.md、state/progress.json、state/findings.jsonl、state/directions_tried.json、state/iteration_log.jsonl（全部经 research_state 读写，它是唯一读写边界）
- logs/（每轮迭代的过程日志）

## 每轮迭代循环

1. research_state {op:'read'} 获取全量状态；
2. 选定本轮方向 —— 先核对 directions_tried.json，禁止重复已试方向；
3. 执行研究动作（检索用 arxiv_search；写代码/实验用常规宿主能力）；
4. research_state {op:'append_finding'}（每条发现必须带 evidence 列表）；
5. research_state {op:'append_direction'}（hypothesis + outcome: progress|stall|fail）；
6. research_state {op:'append_log'} + write_progress 更新迭代计数；
7. stall_check {proposed_direction, new_findings_this_iteration, previous_metric, current_metric} —— 按 recommendation 行动：
   - pivot：改**结构**（换问题框架/环境约束），不是把同一战术调得更狠；
   - escalate：停下来向人报告具体阻塞条件；
   - cap_exceeded：结束循环并交付当前最佳状态。

## 文献漏斗（涉及引用时必须走）

arxiv_search(1-4 查询, max_per_query<=50) -> lit_score(全量候选)。
- must-cite(>=7.0)：必须进入相关工作/引用；
- conditional(5.0-7.0)：与论点相关才引用；
- dropped：不得使用。
注意 citationEmergingImputed=true 的条目：其引用分是 <400 天新文的窗口插补值，属正常，别当成数据错误。
引用写进产物前逐一验证 arXiv id 真实存在（用 arxiv_search 反查 id）——不存在的引用是投稿阻断级缺陷。

## 评审循环（产物成形后）

以五个独立人格打分（每人 0-10 + 具体 critique，禁止互相参照）：
R1 theorist（证明与理论严谨性——实践中多数轮次的绑定约束）、R2 empiricist（实验与证据）、R3 novelty（与已检索文献的差异）、R4 writer（结构与表达）、R5 area-chair（录用综合判断）。
调 peer_review {verdicts, weakness_tags, previous_score} 取中位数分数：
- 用 MEDIAN 不用均值是协议核心：单人格狂热无法抬分；
- scoreBand 是稳健不确定带：band 太宽（judgeDisagreement>=4）先让各人格重写裁决再审；
- 按 nextAction 修复；下一轮把本轮 median 作为 previous_score 传入——scoreDropped=true 不是事故，是可信度信号；
- accept 只在 median>=8.5 且无弱点标签时出现。

## 可视化

研究会话开始时若卡片未开，用 research_ui_switch {feature:'all', action:'on'} 打开五路进度卡片（literature/scoring/panel/guardian/review），让用户看到循环推进；结束后可 off 还原。`

/**
 * Register the protocol skill. Returns a disposer (no-op when the skills
 * subsystem is absent). Never throws: guidance is additive, the tools must
 * survive any failure here.
 */
export function registerResearchSkill(ctx         )             {
  const skills = (ctx                                       ).get?.('skills')                              
  if (!skills || typeof skills.register !== 'function') return () => {}
  try {
    return skills.register({
      name: SKILL_NAME,
      description:
        'AutoResearch 长程自主科研协议：文献漏斗(recall->LQS)、状态文件循环、停滞红绿灯(pivot 结构而非战术)、五人格中位数评审。'
        + '用于文献综述、survey 写作、科研迭代、评审打分等研究任务；配合 arxiv_search/lit_score/research_state/stall_check/peer_review/research_ui_switch 六工具。'
        + 'Trigger: 文献综述, 调研报告, research loop, literature review, novelty check, peer review scoring.',
      whenToUse:
        '用户要求做研究性长任务（综述/idea 迭代/系统评审）时加载本技能并按其循环驱动六件套工具；纯编码任务不要用。',
      source: 'runtime',
      content: SKILL_BODY,
    })
  } catch {
    return () => {}
  }
}
