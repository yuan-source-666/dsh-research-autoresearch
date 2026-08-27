# dsh-research-autoresearch

AutoResearch 科研插件全家桶（单 bundle 发布）：

| 插件 | 工具 | 功能 |
|---|---|---|
| arxiv-search | `arxiv_search` | 文献 Recall（arXiv 检索+去重） |
| lit-score | `lit_score` | LQS 五维评分分桶 |
| research-state | `research_state` | 研究状态/进度面板（7 操作） |
| stall-check | `stall_check` | 停滞检测（pivot/escalate/cap 红绿灯） |
| peer-review | `peer_review` | 五人格中位数评审 |
| research-ui | `research_ui_switch` | 🎛️ 可视化总控台（运行时开关） |

## 结构（仿 dsh-github-manager 工程形态）

```
src/bundle.ts                  宿主半侧入口（6 字段扁平 config）
src/client/locales.ts          卡片双语字典
src/client/card-model.ts       React-free 控制器：staged drafts -> save -> settings scope
src/client/ResearchUiCard.tsx  设置页卡片组件（jsx-runtime + 宿主设计令牌）
src/client/index.ts            浏览器半侧入口（locale/slots/settingsScope）
src/client/shims.d.ts          外部模块环境声明（零 @types 依赖）
tsconfig.client.json           strict 类型检查（npm run typecheck:client）
build.mjs                      宿主半：strip-types -> lib/*.js
scripts/build-client.mjs       浏览器半：tsc transpileModule -> __ModuleLoader__ 信封
tests/smoke-test.mjs           宿主半冒烟（lossless 门 + settings 同步 + 卡门控）
tests/client-smoke.mjs         浏览器半回放（vm 沙箱跑完整 loader 契约）
```

构建：`npm run build`（两半都编译）；测试：`npm test`；类型：`npm run typecheck:client`。
`lib/client.js` 为生成物，勿手改。

## 可视化开关（三档）

1. **套件级**：config.enabled=false → 整个 bundle 不注册（重启生效）
2. **部署级**：`*Cards` 声明式注入各工具进度卡片（默认 false=关闭）
3. **会话级**：`research_ui_switch {feature, action: on|off|reset}` 即时开合；`defaultCards` 总闸播种

卡片关闭 = 展示器返回 undefined → DSH 通用回退，工具功能零影响。
运行时门控在 execute 时盖进 presentationMeta 持久化，会话日志回放永远一致。

## 设计灵感

本插件是 [Deli Chen（陈德里）](https://victorchen96.github.io/) **AutoResearch 框架协议**的 DSH 工具化实现：

- **灵感论文 / 案例研究**：Deli Chen, *从初稿到 Strong-Accept：一篇自我博弈综述如何被推到 8.6*（"From Draft to Strong-Accept: How a Self-Play Survey Hit 8.6"）—— [https://victorchen96.github.io/blog_self_play_story.html](https://victorchen96.github.io/blog_self_play_story.html)。
  该论文 16 轮评审的实证直接塑造了本插件三条核心设计：
  - `peer_review` 采用 **MEDIAN 而非均值**（防单人格抬分，对应其 V14→V16 中位数爬升）；
  - **诚实降分信号**（对应 V12：外部引用核查后框架主动把 8.5 降为 8.2，scoreDropped 字段即为此而设）；
  - `stall_check` 的 "**pivot structure, not tactics**"（结构转向而非战术调参）与 15 轮 / 30 分钟双上限。
- **协议全文**：[AutoResearch Framework Protocol（SKILL.md）](https://victorchen96.github.io/auto_research/framework.html) —— 五工具的状态文件、LQS 权重、五人格评审、行为约束（零交互 / ready-means-execute）逐条来自该协议。

## 测试成果

| 验证层 | 结果 |
|---|---|
| 宿主半冒烟（挂载 / 设置同步 / lossless 注册表门 / inject 契约） | **11/11** |
| 浏览器半回放（vm 沙箱 + cordis 属性门模拟 + 暂存/保存链路） | **9/9** |
| 安装态稳定性探针（真实 profile 内直接执行 6 工具 + 输入卫生 + 重复循环） | **16/16** |
| 冷启动稳定性（隔离 DSH_HOME 连续三次 `dsh web`） | **3/3**（HTTP 200 + boot graph，3–7s，插件树零错误） |
| 真实网络往返（arXiv API / Semantic Scholar 引用数） | arxiv ≈1.0–1.3s 双次稳定；S2 ≈2.9–16.5s（服务端波动），分层计数精确守恒 |
| 类型检查 `tsc --noEmit`（strict, DOM） | 0 诊断 |
| 端到端科研模拟（research-sim harness） | 133/133 |

历史缺陷回归全部锁进断言：`inject ['tools']` 缺失、default 导出遮蔽 inject（曾两次 brick 宿主启动）、NaN 时间戳、空白方向标签。

## 安装

方式一（社区规范 · git 安装，需授权一次 prepare 构建）：

```bash
dsh plugin --profile web add github:<your-github-user>/dsh-research-autoresearch
```

方式二（预构建 tarball，免构建授权）：

```bash
npm run build && npm pack
dsh plugin --profile web add ./dsh-research-autoresearch-0.2.5.tgz
```

安装后在 profile 的 `cordis.patch.yml` 加 `- id: dsh-research-autoresearch` + `disabled: true` 可整体停用；Web 设置页「插件配置」的 **科研可视化总控台** 卡片可运行时切换五路可视化（zh/en 双语界面）。
