# 决策记录

> 记录 dsh-journal-club 设计过程中的关键决策：定论、理由、被否方案。改设计前先读这里；推翻某条时在此追加修订记录，不删除历史。
> 时间线：2026-10-26 单日设计会话 + 评审修订。

## D1 主形态：dsh 自定义工作台 UI 插件

- **决策**：做成 dsh 插件（tools + skill + UI 扩展），交互主体是右侧栏工作台 + 聊天卡片，而非纯对话或独立应用。
- **理由**：用户在三个候选（对话式 skill / 工作台 UI 插件 / headless 管道）中明确选择工作台形态——图源核对这类精细交互需要稳定的图形界面。
- **被否**：纯对话 skill（图源核对质量不可控）；headless 全自动管道（无核对环节，切错返工成本高）；保留 SmartJC 独立 PWA 换 dsh 后端（重复建设，脱离 dsh 生态）。

## D2 人工介入：三个确认点

- **决策**：图源核对、outline.md、deck.md 渲染前三个暂停点；其余自动。确认点 3 是成本门槛（markdown 预览/拼图秒级 vs PPTX 渲染分钟级）。
- **被否**：全自动 + 事后修改（切错返工贵）；逐步深度确认（繁琐）。确认点最初为 2 个，deck 渲染前确认是评审前用户补充（渲染成本论据）。

## D3 文件即真相，无项目列表

- **决策**：项目文件夹 = 会话工作目录下 `<论文名>/`，PDF 复制入内；产物全部是普通文件；无项目管理 UI；jc.md 记状态（stage 是缓存，confirmations 是确认事实）。
- **理由**：用户明确要求「让用户自己用文件夹管理」；与 dsh 文件工作流哲学一致。
- **被否**：统一 jc/ 根目录（不如就地灵活）；兄弟文件夹隔离（同篇论文分两处）；项目列表 UI（管理归资源管理器）。

## D4 产物 markdown 化，PPTX 不自研

- **决策**：outline.md / deck.md 人读 markdown 契约（维护 = 编辑文件，dsh 预览自动刷新）；PPTX 生成交生态插件（主路径 dsh-ppt-maker：agent 读 deck.md 构建 PPTD 工程）；deck.md 单向派生，不双向同步。
- **理由**：用户指定「生成 markdown 版 ppt，预览靠现成的，只维护拼图小模块」；生态调研证实无插件直接吃 markdown，agent 即转换器。
- **被否**：自研 PptxGenJS 导出（SmartJC 遗产但 v1 不搬）；deck 用 PPTD YAML 直接表达（人读与预览差）。

## D5 预览全部依赖 dsh 现成能力

- **决策**：markdown / 图片 / PPTX（office-to-pdf）预览统一走 dsh documentpreview，插件只做「打开预览」入口。
- **理由**：用户明确要求；核实 documentpreview 支持 markdown 内嵌相对路径图片与 PPTX→PDF。
- **被否**：自研讲稿渲染 / HTML 幻灯片预览器 / 逐页缩略图卡片。

## D6 证据关联：结构化关联 + 程序校验，交互让位

- **决策**：内嵌图即关联（文件名=稳定 ID）、figures.json 锚点、疑点标记、validate 一致性检查（Panel 覆盖）；反向查询走对话。
- **理由**：保留 SmartJC 证据网络内核（来源可查、覆盖可检），舍弃三栏双向跳转 UI。
- **被否**：仅图文混排（覆盖/引用检查丢失）；自研证据面板（违背不写大纲编辑器决策）。

## D7 agent 信任与工具原子化（用户原则）

- **决策**：对话修正直接写文件（diff 即监督，无候选审批门）；5 个原子工具零耦合、文件接口、可单独调用；四步流程只是 skill 剧本；论文类型门槛只在 skill 层（Review 也能只切图）。
- **理由**：用户提出「给大模型足够的信任与自由度；组合优于继承；工具原子性——只要 figure 切分也能单独用」。
- **被否**：SmartJC 的图源只读 AI 与候选确认门（为其 PWA 内嵌小循环的不可控性设计，dsh 场景不适用）。

## D8 PDF 解析：官方 mineru-open-api CLI

- **决策**：不自研解析，用 OpenDataLab 官方 CLI；高精度模式（注册+token）为完整流程默认，flash 免费模式明示降级试用；首次解析前 skill 检测并给注册引导；缓存按 parse/manifest.json 四条件命中。
- **理由**：用户指出官方生态有 skill/CLI（「是不是官方更好」）；权威维护、flash 零配置、依赖收敛为一个 npm CLI。
- **被否**：自研 MinerU API client；生态插件 dsh-pdf-mineru（个人维护、双重 preview 风险，降为 README 备选）；PyMuPDF 自研解析管线（v2 曾选，工作量与质量均劣）。

## D9 全栈 Node，零 Python

- **决策**：pdfjs-dist + @napi-rs/canvas（渲染/裁切）、sharp（拼图），全部预编译 npm 包。
- **理由**：用户明确要求 Node 技术栈减少依赖。
- **被否**：Python 引擎（PyMuPDF/OpenCV——v2 曾选，算法生态强但引入运行时依赖）。

## D10 Panel 切分：agent 视觉 + crop 反馈闭环

- **决策**：MinerU 给整图 bbox → agent 看高清页图视觉切 panel（经 update_figures）→ crop 裁出验证 → 迭代修正；工作台手调兜底；本地零 OCR 零几何。
- **理由**：用户明确「使用大模型自己的视觉能力，不依赖 OCR 兜底」；crop 反馈闭环替代几何算法。
- **被否**：detect_figures 几何工具（v2 曾设，v3 砍）；本地 OCR。风险保留：M2 卡点 ≥80% 可用率，不达标再补轻量几何辅助（候选不预建）。

## D11 复用 SmartJC 优先

- **决策**：A（直接搬运：prompts 16 文件、computeLayout、figureCaptions…）/ B（规则移植：校验、narrativeRules、workflows 蓝本…）/ C（参考适配：pdf 数学、工作台交互）/ D（不搬：IndexedDB、pi-agent-core…）四级清单，见架构 §1.3。
- **理由**：用户明确「SmartJC 有很多现成实现，考虑复用而非重新开发」。

## D12 UI 零新增依赖

- **决策**：React 由宿主提供（peer）；CSS Modules + `--dsh-alias-*` token + ui-primitives；不引状态库、不引 Tailwind。
- **理由**：dsh web-styling 明文禁止组件库与 Tailwind；明暗主题自动跟随零成本。
- **被否**：搬 SmartJC 的 Tailwind 主题（违反宿主约定，已从复用清单更正）。

## D13 评审修订七条（v3.1）

外部评审发现七项契约缺口，全部采纳：

1. **groups.json** 图组清单（成员/输入指纹/布局）——validate 展开成员检查，重裁提醒重建。
2. **jc.md confirmations**——确认记录 digest 化；恢复时「产物存在」≠「已确认」，无法证明停确认点。
3. **update_figures 第 5 工具**——figures.json 唯一写入通道（json-patch + base-rev 乐观锁 + 滚动快照）；UI 经 host RPC（dsh workspaceFiles 只读的事实落实）；属数据完整性保护，非审批门，与 D7 不冲突。
4. **parse/manifest.json** 缓存四条件（源摘要/模式/done/产物齐）——防不完整、过期、换模式误复用。
5. **whole-Panel 归一化**——无 Panel 单图 = 空标签 panel，数据无特判。
6. 旧工具链残留清理（对话入口/图源核对/架构三处）。
7. **校验分层**——程序管可判定项（讲稿缺失=error 阻断渲染）；发现覆盖归 agent 语义自查（自由文本无发现 ID，不做程序承诺）。

## 修订记录

- 2026-10-26：初版（D1–D13）。
