/**
 * Research state management tool — persistent, file-backed state for a single
 * AutoResearch task. Implements the "Persist state to files" behavioral
 * constraint of the AutoResearch framework: each iteration starts a fresh
 * session, injecting only curated state. This tool reads/writes the canonical
 * state files.
 *
 * State layout (per task directory):
 *
 *   {task}/state/
 *   ├── task_spec.md           # goal / milestones / success criteria
 *   ├── progress.json          # {iteration, status, stale_count, ...}
 *   ├── findings.jsonl         # accumulated findings (append-only)
 *   ├── directions_tried.json  # directions tried (basis for diversity)
 *   └── iteration_log.jsonl    # per-iteration summary
 *
 * @module @deepseek-ai/dsh-tool-research-state
 */

                                                  
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'tool-research-state'
export const inject = ['tools']

/**
 * Per-task mutator lock. The counter increment in append_finding is a
 * read-modify-write on progress.json; concurrent appends would otherwise
 * lose updates (a classic lost-update race). Serializing all mutators per
 * task directory keeps the counter atomic within a process.
 * key: absolute task_dir, value: tail promise that never rejects.
 */
const mutationTails = new Map                          ()

function enqueue   (key        , task                  )             {
  const prev = mutationTails.get(key) ?? Promise.resolve()
  const run = prev.then(task)
  // Store a never-rejecting tail so one failed mutation cannot wedge the queue.
  mutationTails.set(key, run.then(() => undefined, () => undefined))
  return run
}

/** A single finding, appended to findings.jsonl. */
                          
                       
            
                                                    
                   
                                          
                     
                                                     
                    
                                                               
                   
 

/** A direction that has been tried, for diversity enforcement. */
                                 
            
                   
                                       
               
                                            
                    
                                                
                                        
 

/** progress.json shape. */
                                
                   
                                                                   
                    
                       
                     
 

/** One iteration summary entry in iteration_log.jsonl. */
                                    
            
                   
                   
                     
                
               
 

/** The operation to perform. */
         
                  
                                                              
                                                          
                                                                     
                                                              
                                         

                              
            
                                
                     
                              
                                   
                                                                                    
                   
                                                                                              
                         
 

async function ensureDir(path        )                {
  await fs.mkdir(path, { recursive: true })
}

async function readJsonIfExists   (path        , fallback   )             {
  try {
    const content = await fs.readFile(path, 'utf8')
    return JSON.parse(content)     
  } catch {
    return fallback
  }
}

async function readJsonlIfExists   (path        )               {
  try {
    const content = await fs.readFile(path, 'utf8')
    return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)     )
  } catch {
    return []
  }
}

async function readTextIfExists(path        )                         {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function appendJsonl(path        , entry         )                {
  await fs.appendFile(path, JSON.stringify(entry) + '\n', 'utf8')
}

/** Display labels for each operation, used by the call card title. */
const OP_LABELS                         = {
  read: '📖 读取科研状态',
  write_progress: '✏️ 更新研究进度',
  append_finding: '🔍 记录研究发现',
  append_direction: '🧭 登记研究方向',
  append_log: '📜 记录迭代日志',
  write_spec: '📋 写入任务规格',
}

/** Emoji badges for stall recommendations. */
const DEFAULT_PROGRESS                = {
  iteration: 0,
  status: 'pending',
  staleCount: 0,
  totalFindings: 0,
  lastUpdated: new Date().toISOString(),
}

const TOOL_DESCRIPTION =
  'Read or update persistent state for an AutoResearch task. The framework constraint '
  + '"Persist state to files" requires that every iteration starts fresh and injects only '
  + 'curated state from disk; this tool is the single read/write boundary for the five state '
  + 'files (task_spec.md, progress.json, findings.jsonl, directions_tried.json, '
  + 'iteration_log.jsonl). Supports read, write_progress, append_finding, append_direction, '
  + 'append_log, and write_spec operations.'

/** Card-visualization switch, mirroring tool-bash's enableRunInBackground config gate. */
                         
     
                                                                        
                                                                      
                                                                                
     
                       
 

export const Config            = z.object({
  enableCards: z.boolean().default(true),
})

/** Structural probe of the optional researchUi service (tutorial ch.3 optional dependency). */
                           
                                                      
 

/** Which researchUi feature flag gates this tool's cards. */
const UI_FEATURE = 'panel'

export function apply(ctx         , config        )       {
  const getUi = ()                              =>
    (ctx                                       ).get?.('researchUi')                               
  // Effective gate for execute-time stamping: runtime override wins, else own config.
  const gate = ()          => getUi()?.getCardEnabled(UI_FEATURE) ?? config.enableCards
  ctx.tools.register(defineTool({
    name: 'research_state',
    description: TOOL_DESCRIPTION,
    parameters: {
      task_dir: {
        type: 'string',
        required: true,
        description: 'Absolute path to the task directory (containing state/ and logs/ subdirs).',
      },
      op: {
        type: 'object',
        required: true,
        description: 'Operation to perform.',
        additionalProperties: false,
        properties: {
          op: {
            type: 'string',
            required: true,
            enum: ['read', 'write_progress', 'append_finding', 'append_direction', 'append_log', 'write_spec'],
          },
          progress: {
            type: 'object',
            additionalProperties: true,
            properties: {
              iteration: { type: 'integer' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'stalled', 'done', 'failed'] },
              staleCount: { type: 'integer' },
              totalFindings: { type: 'integer' },
              lastUpdated: { type: 'string' },
            },
          },
          finding: {
            type: 'object',
            additionalProperties: false,
            properties: {
              iteration: { type: 'integer', required: true },
              description: { type: 'string', required: true },
              evidence: { type: 'array', items: { type: 'string' }, required: true },
              direction: { type: 'string', required: true },
            },
          },
          direction: {
            type: 'object',
            additionalProperties: false,
            properties: {
              iteration: { type: 'integer', required: true },
              label: { type: 'string', required: true },
              hypothesis: { type: 'string', required: true },
              outcome: { type: 'string', required: true, enum: ['progress', 'stall', 'fail'] },
            },
          },
          entry: {
            type: 'object',
            additionalProperties: false,
            properties: {
              iteration: { type: 'integer', required: true },
              direction: { type: 'string', required: true },
              newFindings: { type: 'integer', required: true },
              status: { type: 'string', required: true },
              notes: { type: 'string', required: true },
            },
          },
          content: { type: 'string' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', required: true },
          progress: {
            type: 'object',
            additionalProperties: true,
            properties: {
              iteration: { type: 'integer' },
              status: { type: 'string' },
              staleCount: { type: 'integer' },
              totalFindings: { type: 'integer' },
              lastUpdated: { type: 'string' },
            },
          },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'string', required: true },
                iteration: { type: 'integer', required: true },
                description: { type: 'string', required: true },
                evidence: { type: 'array', items: { type: 'string' }, required: true },
                direction: { type: 'string', required: true },
              },
            },
          },
          directions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'string', required: true },
                iteration: { type: 'integer', required: true },
                label: { type: 'string', required: true },
                hypothesis: { type: 'string', required: true },
                outcome: { type: 'string', required: true },
              },
            },
          },
          iterationLog: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'string', required: true },
                iteration: { type: 'integer', required: true },
                direction: { type: 'string', required: true },
                newFindings: { type: 'integer', required: true },
                status: { type: 'string', required: true },
                notes: { type: 'string', required: true },
              },
            },
          },
          taskSpec: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'research_state ' + args.op.op + ' on ' + args.task_dir
          + ': progress=' + JSON.stringify(value.progress)
          + ', findings=' + value.findings.length
          + ', directions=' + value.directions.length,
      }],
      presentationMeta: (_args, value) => ({ ...value, ui: { cards: gate() } }),
    },
    async execute(args, exec) {
      const taskDir = args.task_dir
      const stateDir = join(taskDir, 'state')
      const logsDir = join(taskDir, 'logs')
      await ensureDir(stateDir)
      await ensureDir(logsDir)
      const op = args.op      
      const now = new Date().toISOString()

      const applyOp = async ()                => {
        switch (op.op) {
          case 'write_spec': {
            await fs.writeFile(join(stateDir, 'task_spec.md'), op.content ?? '', 'utf8')
            break
          }
          case 'write_progress': {
            const current = await readJsonIfExists               (
              join(stateDir, 'progress.json'), DEFAULT_PROGRESS)
            const merged                = {
              ...current,
              ...op.progress,
              lastUpdated: now,
            }
            await fs.writeFile(join(stateDir, 'progress.json'), JSON.stringify(merged, null, 2), 'utf8')
            break
          }
          case 'append_finding': {
            const finding          = { ...op.finding, ts: now }
            await appendJsonl(join(stateDir, 'findings.jsonl'), finding)
            // Increment totalFindings in progress — serialized by enqueue so the
            // read-modify-write cannot lose concurrent updates.
            const current = await readJsonIfExists               (
              join(stateDir, 'progress.json'), DEFAULT_PROGRESS)
            current.totalFindings = (current.totalFindings ?? 0) + 1
            current.lastUpdated = now
            await fs.writeFile(join(stateDir, 'progress.json'), JSON.stringify(current, null, 2), 'utf8')
            break
          }
          case 'append_direction': {
            const dir                 = { ...op.direction, ts: now }
            await appendJsonl(join(stateDir, 'directions_tried.json'), dir)
            break
          }
          case 'append_log': {
            const entry                    = { ...op.entry, ts: now }
            await appendJsonl(join(logsDir, 'iteration_log.jsonl'), entry)
            break
          }
          case 'read':
          default:
            // No mutation; just read everything.
            break
        }
      }
      // Mutations are serialized per task directory; reads stay lock-free.
      if (op.op === 'read') {
        await applyOp()
      } else {
        await enqueue(taskDir, applyOp)
      }

      // Always return the full current state.
      const progress = await readJsonIfExists               (
        join(stateDir, 'progress.json'), DEFAULT_PROGRESS)
      const findings = await readJsonlIfExists         (join(stateDir, 'findings.jsonl'))
      const directions = await readJsonlIfExists                (join(stateDir, 'directions_tried.json'))
      const iterationLog = await readJsonlIfExists                   (join(logsDir, 'iteration_log.jsonl'))
      const taskSpec = await readTextIfExists(join(stateDir, 'task_spec.md'))
      const output              = {
        op: op.op,
        progress,
        findings,
        directions,
        iterationLog,
        // Lossless-JSON contract + string schema: only carry the key when a
        // spec actually exists (null/undefined both omit).
        ...(typeof taskSpec === 'string' ? { taskSpec } : {}),
      }
      return output
    },
    // Pending card: which state operation is running, with the task dir as raw input.
    presentCall: (args) => {
      if (!config.enableCards) return undefined
      return {
        card: 'generic',
        kind: 'other',
        title: OP_LABELS[(args.op                  ).op] ?? '科研状态操作',
        rawInput: args.task_dir,
      }
    },
    // Completed card: THE RESEARCH PROGRESS PANEL — every research_state call
    // returns the full state snapshot, so this card always shows the live
    // iteration / status / stale counter / findings totals for the task.
    presentResult: (_args, result) => {
      if (result.isError) return undefined
      const v = result.meta               
      if (!v || !v.progress || typeof v.progress.iteration !== 'number'
        || !Array.isArray(v.directions) || !Array.isArray(v.findings) || !Array.isArray(v.iterationLog)) return undefined
      if (!v.ui || v.ui.cards !== true) return undefined
      const p = v.progress
      const stallWarn = p.staleCount >= 2 ? '  ⚠ 需结构性转向' : ''
      const lines = [
        '迭代轮次：' + p.iteration,
        '运行状态：' + p.status,
        '停滞计数：' + p.staleCount + stallWarn,
        '累计发现：' + p.totalFindings,
        '已登记方向：' + v.directions.length,
        '发现记录：' + v.findings.length + ' 条',
        '迭代日志：' + v.iterationLog.length + ' 条',
      ]
      return {
        card: 'generic',
        title: '🧪 研究进度 · 第 ' + p.iteration + ' 轮 · ' + p.status + ' · ' + p.totalFindings + ' 项发现',
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  }))
}
