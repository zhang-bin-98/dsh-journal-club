# dsh-journal-club

运行在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 内的生物医学论文 **Journal Club 汇报插件**：研究者上传论文 PDF，由 agent 完成解析、图源切分、叙事大纲与幻灯片分页，交付可转 PPTX 的 markdown 版幻灯片（含讲稿与图组）。

> **状态：五个工具、skill 文件链、工作台与 host RPC、项目发现和聊天确认入口已实现；85 项回归、桌面拖框写入及 PPTX 本地工具链已验证。完整论文端到端验收仍未完成。** 本次证据见 [开发验收](docs/verification/development-acceptance.md)、[PPTX 集成](docs/verification/pptx-integration.md)，实现取舍见 [D19](docs/decisions.md#d19-文件链与宿主集成收口2026-10-29)。

## 开发

```sh
npm install        # 安装依赖（Node ≥ 22.13）
npm run typecheck  # 类型检查
npm test           # vitest 固定 fixture 回归（3 篇真实论文 + 旋转页资产 + MinerU 真实解析产物）
npm run build      # 构建 host（lib/index.js）与 client（lib/client.js，dsh client-modules 工厂格式）
```

安装到 dsh：`dsh plugin add <本仓库路径>`（bundle 声明与插件行见 `package.json` 的
`dsh` 字段与 `cordis.patch.yml`）。已注册工具：`render_pages`（PDF 页 → PNG 底图）、`crop`（figures.json panel bbox → figures/<id>.png）、
`compose_panels`（拼合 Panel 并登记 groups.json）、`update_figures`（初始化 / RFC 6902 patch + base_rev CAS + .history 快照）、`validate`（figures/groups/deck 一致性校验）。

项目状态 helper 可由 `dsh-journal-club/project` 导入；skill 与文件示例、科研叙事规则、五种研究策略一并随包交付。完整流程在论文子文件夹中创建 `jc.md` 和空 `groups.json`，首次图源写入使用 `update_figures` 的 `base_rev: 0` 初始化协议；局部任务不创建项目状态。

MinerU CLI 用法已按 v0.5.9 帮助核实：在项目目录运行 `mineru-open-api extract main.pdf -f md,json -o parse/main/`，补充材料单独解析；云端解析会上传论文，token 通过 CLI auth 或环境变量配置，不写入项目。PPTX 主路径为外部 dsh-ppt-maker，需在目标宿主安装并验收；未安装时仍保留 markdown 与图片产物。

## 核心闭环

**在会话工作目录发起 → 插件建项目文件夹并复制 PDF → 论文解析与自动切图（MinerU + agent 视觉）→ 图源核对【确认点 1】→ 叙事大纲 outline.md【确认点 2】→ 幻灯片分页 deck.md 与拼图【确认点 3：渲染前确认】→ PPTX 渲染（agent + 生态插件）。**

产品移植自 [SmartJC](https://github.com/)（独立 PWA 形态的同类产品，叙事规则与流程设计的来源），运行形态换成 dsh 插件。

## 形态要点

- **文件即真相**：一切产物是项目文件夹里的普通文件（`jc.md` / `figures.json` / `analysis.md` / `outline.md` / `deck.md` / 图片），dsh 右侧栏 markdown 预览自动刷新，无私有存储。
- **右侧栏工作台 + 聊天轻卡片**：图源核对的富交互（框叠加、调框、裁切预览）在固定的右侧栏工作台；聊天卡片只做流程推进与确认入口。
- **agent 信任与自由度**：不自建审批流——agent 修改产物文件与编辑代码同等地位，diff 聊天可见；图源写入统一经 `update_figures`（乐观锁，防并发覆盖）。
- **工具原子化**：5 个原子工具（渲染 / 裁切 / 拼图 / 图源写入 / 校验），零相互耦合、以文件为接口，可单独调用；四步流程只是 skill 编排的默认剧本。
- **复用优先**：SmartJC 的提示词、图组布局算法、叙事规则、workflow 蓝本按清单搬运（架构 §1.3），不重新开发。
- **依赖极简**：纯 Node（pdfjs-dist / @napi-rs/canvas / sharp / zod）+ 全局官方 `mineru-open-api` CLI；预览与 PPTX 生成用 dsh 生态现成能力（documentpreview / office-to-pdf / dsh-ppt-maker）。

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs 索引](docs/README.md) | 文档地图、阅读顺序、术语速查 |
| [产品设计](docs/product/产品设计.md) | 定位、闭环、形态、分步设计、边界 |
| [图源核对](docs/product/图源核对.md) | 唯一富交互组件的交互细化 |
| [deck 格式](docs/product/deck格式.md) | deck.md 契约与 PPTX 对接路径 |
| [对话入口](docs/product/对话入口.md) | 触发分流、恢复、jc.md 状态文件 |
| [架构设计](docs/architecture/架构设计.md) | 选型、包结构、工具契约、数据契约、M1–M6 计划 |
| [决策记录](docs/decisions.md) | 关键决策、理由与被否方案 |

## 路线图

| 阶段 | 内容 |
|---|---|
| M1 | 渲染底座（插件骨架、pdf 封装、render_pages / crop、MinerU CLI 实测） |
| M2 | 切分剧本与契约（figures.json、agent 视觉切分、update_figures、validate） |
| M3 | skill 与文件链（全剧本、analysis/outline/deck 生成、确认点与恢复） |
| M4 | 核对工作台（右侧栏 UI） |
| M5 | 拼图与渲染（compose_panels + groups.json、PPTX 编排） |
| M6 | 打磨与端到端验收 |

## 致谢

- **SmartJC**（本地参考项目，见架构 §1.3 复用清单）——产品闭环、叙事规则与大量可复用实现的来源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——运行平台。
- [MinerU](https://github.com/opendatalab/MinerU) / [mineru-open-api](https://github.com/opendatalab/MinerU-Ecosystem)——PDF 解析。
- [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker)——PPTX 渲染生态路径。
