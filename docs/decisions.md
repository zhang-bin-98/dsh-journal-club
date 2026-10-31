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
- **被否**：detect_figures 几何工具（v2 曾设，v3 砍）；本地 OCR。风险保留：记录模型切分可用率，以人工检查与调框兜底；不以 ≥80% 或固定轮数作为系统验收硬门槛（见 D28），不预建几何辅助。

## D11 复用 SmartJC 优先

- **决策**：A（直接搬运：prompts 16 文件、computeLayout、figureCaptions…）/ B（规则移植：校验、narrativeRules、workflows 蓝本…）/ C（参考适配：pdf 数学、工作台交互）/ D（不搬：IndexedDB、pi-agent-core…）四级清单，见架构 §1.3。
- **理由**：用户明确「SmartJC 有很多现成实现，考虑复用而非重新开发」。

## D12 UI 零新增依赖

- **决策**：React 由宿主提供（peer）；`jc-` 前缀内联样式表 + `--dsh-alias-*` token + ui-primitives；不引状态库、不引 Tailwind（原定 CSS Modules，D18 实测后改为内联样式表）。
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

## D14 M1 实测结论与实施偏差（2026-10-28）

M1（渲染底座）实施中的四项关键事实，均已回写架构文档相应段落：

1. **dsh 工具参数 DSL 取代 zod schema**：架构 v3 写「defineTool schema（zod）」；
   实际 dsh-tools 的 `defineTool` 使用自有参数 DSL（`{ type, required, enum… }`）
   与 canonical output schema，zod 降级为内部数据契约校验（figures.json）。
   工具实现契约（注册即 effect、output.render、exec.signal）按官方文档与
   dsh-tools 0.2.2-alpha.2 实测编写。
2. **pdfjs-dist v6 Node 官方配对即 @napi-rs/canvas**：`NodeCanvasFactory` 直接
   require @napi-rs/canvas（无需自建 canvas 工厂）；Node 无 Worker 环境须设
   `globalThis.pdfjsWorker` 走主线程 fake worker；`render({canvas, viewport,
   transform})` 的 transform 先于 viewport.transform 进入 CTM（画布空间平移），
   SmartJC 裁剪数学原样成立（crop=整页切片一致性回归固化）。
3. **MinerU bbox 坐标基准 = 两轴各自 0–1000 归一化**（非 PDF pt、非统一像素栅格）：
   `pt = norm/1000 × 旋转后页面尺寸`；三篇真实论文叠加目视验证（证据：
   [docs/verification/m1-mineru-overlay](verification/m1-mineru-overlay/README.md)）。
   个别复杂大图整图框偏小属检测质量问题，由 agent 视觉切分兜底。json=content-list、
   images/ 随包落盘，架构 §8 两项「M1 首项实测」风险关闭。
4. **client bundle 按 dsh client-modules 工厂契约手工产出**：共享 tsdown 预设
   是 harness monorepo 内部文件，外部插件不可引；按 `window.__ModuleLoader__
   .load({id, factory})` 闭包格式 + 平台基线 externals 自建 `tsdown.client.ts`
   （空壳产物已冒烟验证 factory 执行）。M4 工作台的样式按 D18 以内联样式表
   进入同一工厂，不走 CSS 管线。

被否：自建 canvas 工厂适配层（pdfjs v6 原生支持）；把 0–1000 归一化当成 pt
直接写入 figures.json（三篇叠加证明必然错位）；为 client 空壳引入 monorepo
预设副本（违反零依赖原则）。

## D15 M2 图源写入与校验实现默认值（2026-10-28）

M2 将 v3.1 的数据完整性契约落为可回归的 Node 实现，默认细节固定如下：

1. **JSON Patch 采用 RFC 6902 风格六操作**：`add`、`remove`、`replace`、`move`、`copy`、`test`；JSON Pointer 支持 `~0`/`~1`，拒绝危险对象键、非法数组索引和未知操作。`revision` 是服务维护字段，非 `test` patch 不得直接修改。
2. **乐观锁与并发**：`base_rev` 必须是非负整数；写入时在独占 `.lock` 下重新读取当前文件并比较 revision，进程内同一路径再串行排队。匹配才应用 patch；冲突返回结构化结果，不改主文件、不生成快照。残留锁回收见 D30。
3. **快照**：成功替换前写入项目 `.history/`，保存旧 figures.json；默认保留最近 10 份，超出滚动清理。主文件采用临时文件完整写入后 rename；快照或主文件写失败均不推进 revision。
4. **跨字段校验**：写入前除基础 schema 外检查 document/figure/panel ID 唯一、region/document/page 引用、region_index、caption_refs、asset 身份与有限非退化 bbox。crop 的 asset 回写也通过该唯一写入服务，避免第二套写入口。
5. **validate 分层**：程序只报告确定性 `errors`/`warnings`；figures.json 跨字段违例复用第 4 条同一规则，统一报 `FIGURES_INVALID`（D30）；deck 页头、页号、来源、图片身份、图组成员、讲稿缺失属于 error；旧 figures revision、图组 digest 失配、Panel 未引用、图文讲稿不对应属于 warning；outline 只检查存在与 revision，不把发现覆盖和叙事质量伪装成程序判定。
6. **M1 安全收口**：工具相对路径按 dsh session cwd 解析；panel ID 拒绝路径穿越和 Windows 保留名；PNG 原子替换；PDF 缓存按 size/mtime/ctime 失效；render_pages 对清洗后可能碰撞的源文件名追加稳定短标识。

M2 验证：`npm run typecheck`、`npm test`（29/29）和 `npm run build` 均通过；真实 dsh 安装加载仍待宿主环境验收。

被否：仅依靠 `figuresJson` 的原子 rename（缺少 CAS/快照/patch 回滚）；让 crop 直接保存 figures.json（会绕过唯一写入通道）；由 validate 判断发现覆盖或科学因果表达（超出可判定契约）。

## D16 M3–M5 实施状态与验收边界（2026-10-29）

以下记录该次交付时的边界；后续桌面验证见 D18，本次文件链与 Remote 修复见 D19。

- **M3 文件链实现**：新增 `src/skills/journal-club/SKILL.md` 与 `src/project/jcState.ts`，覆盖完整/局部/恢复分流、MinerU manifest 四条件缓存、三确认点、jc.md digest/revision 失效与恢复停点；单元测试覆盖状态读写/确认有效性。真实 dsh skill registry 挂载与三篇论文纯对话端到端尚未验收。
- **M4 client 工作台实现**：新增 JC tab/store/workbench/样式表，覆盖空态/状态卡/图源工作台、workspaceFiles read/watch、bbox 框与四角编辑、图注关联、裁切预览和冲突提示；写入只调用约定的 `remote.journalClub.updateFigures`。client bundle 与 store/geometry 测试通过，但**host 侧 `journalClub` RPC 服务尚未注册，真实 dsh/browser 页面交互未验证**，故不能宣称 M4 端到端完成。
- **M5 compose 核心实现**：新增 `compose_panels`，支持 grid/rows/1+2、sharp 输出与 groups.json 成员/digest/几何登记；单测覆盖构图、缺失成员、重拼和输出契约。真实图片人工质量验收、与实际 dsh host 的加载尚未完成；PPTX 外部插件链仍未验证。
- **阶段总验收未完成**：没有真实 dsh 安装运行、JC 工作台人工交互、三篇论文全链确认/恢复或 PPTX 导出证据。以上作为 M6/宿主集成验收项继续跟踪，不以 typecheck/build 通过代替。

## D17 Remote 写入集成边界与未完成项（2026-10-29）

本条保留当时阻塞原因；D19 已补独立包生成适配，真实页面验收仍需单独记录。

- M4 client 工作台调用约定的 `remote.journalClub.updateFigures`，但独立 npm bundle 没有 host Typert Remote owner；不能把该调用视为已接通。
- 调研 harness 官方 `TypertRemoteService` 与生成器：生成器要求 harness workspace 根目录同时有 `tsconfig.host.json` 和 `packages/`；`mode: package` 也走 `findWorkspaceRoot()`，不能在本仓库的独立 bundle 目录运行。NPM `@deepseek-ai/dsh-typert-generator@0.0.1-rc.1` peer Cordis 与当前 `4.0.6-alpha.1` 冲突；较新生成器依赖匹配，但仍有 workspace root 限制。
- 因此未手工伪造 Remote descriptors，也未用 `--force` 安装不兼容 generator；client 在 RPC 未提供时保持 fail-closed，禁止绕过 `update_figures` 直接写文件。
- **待宿主集成**：需要在 dsh profile/bundle 侧提供 Typert host/controller package face 与生成的 `./remote` contribution，再运行真实 Web/desktop session 验证读取、watch、CAS 写入和冲突 UI。当前 M4 只能标记为 client 实现已完成、真实写入链未验收。
- 最终自动门禁（2026-10-29）：typecheck、host/client build、49/49 测试与 `npm pack --dry-run` 通过；浏览器交互、三篇论文从冷启动到 PPTX 的完整链未执行。

## D18 桌面宿主实测：client 加载契约（2026-10-29）

在本机 DeepSeek Harness 桌面版（runtime 0.2.1-rc.3）上以 `dsh plugin --profile desktop add <本仓库>` link 安装后实测，暴露并修复三项加载契约问题：

1. **工厂闭包内不能有 CSS import**：tsdown CSS 管线在工厂顶部产出 `import './style.css'`，渲染层报 `Cannot use import statement outside a module`，整个 web boot 失败（应用弹窗「1 entry did not activate」）。改为 `src/client/styles.ts`：`jc-` 前缀类名的样式字符串，`apply` 时复用同一个 `<style>` 节点并更新变化的内容，删除 `.module.css` 与 `@tsdown/css`。2026-10-30 新版 UI 宿主验收发现旧节点使新增样式未生效，已修复仅按节点存在就跳过的逻辑；热重载后列表、固定确认栏与原生模态恢复正常。
2. **服务依赖要在模块级导出 `inject`**：在 `apply` 内调 `ctx.inject([...], cb)` 时，回调没有触发，tab 不出现，也没有报错。宿主内置插件（sidebar-files 等）都是模块级 `export const inject = [...]`，由 loader 等服务就绪后再调 `apply`。改为同样写法（`slots`、`sidebarRightTabs`、`remote`、`remote.workspaceFiles`）后，右侧栏引导出现「Journal Club」入口，点开后空态正常渲染，console 无错误。

3. **skill 文件路径错位**：host 侧按 `lib/index.js` 相对路径读 `./skills/journal-club/SKILL.md`，但包里只随带 `src/skills/journal-club/SKILL.md`，读取失败只进日志，斜杠菜单里没有 `journal-club`。改为解析 `../src/skills/journal-club/SKILL.md`（src 与 lib 下都成立），同步读取并从 frontmatter 取 name/description（与宿主 skill-office 一致），新增 `tests/skill.spec.ts` 固化。

- **已验证**：桌面版启动正常；插件出现在 boot entries；样式表已注入；JC tab 注册并渲染空态；斜杠菜单列出 `journal-club` skill；桌面会话里模型列出 5 个工具并确认 `journal-club` skill 可用。
- **已验证（探针项目）**：默认工作区放入 `jc.md`、真实 PDF（2605.13902）经 `render_pages` 生成的页图和两 panel 的 `figures.json`。三态切换实测：只有 `jc.md` 时显示状态卡；有 `figures.json` 时显示工作台，页图加载（1275×1651），两个框按 bbox 叠在页图上；外部改写 `figures.json`（revision 2、改图注、改 B 高度）后无需手动刷新即更新并标「刚刚变更」；删掉 `figures.json` 自动退回状态卡，恢复后自动回到工作台。全程 console 无错误。
- **当次未验证**：`update_figures` 写入链（当时 D17 的 host RPC 仍未接通，工作台的调框/采纳保存会 fail-closed）、三篇论文全链与 PPTX。headless profile 用不了桌面账号 provider（`ACCOUNT_SIGN_IN_REQUIRED`），所以 agent 侧工具/skill 的真实调用要在桌面版对话里验收。
- 被否：保留 CSS Modules 再给工厂补 CSS loader（宿主没有公开这个契约）；在 `apply` 内轮询等服务（与宿主 loader 语义重复）。

## D19 文件链与宿主集成收口（2026-10-29）

- **首次图源写入**：修复 skill 要求唯一写入通道而服务不能创建文件的闭环缺口。缺文件时 base_rev=0，对空初值应用现有 JSON Patch；完整数据校验后写 revision=1，首次无旧版快照。已有文件继续严格 CAS，初始化和更新共享锁与写入服务，不新增工具。
- **状态与 skill 交付**：jc.md 内联对象只分隔键后的第一个冒号，兼容文档中的未加引号 ISO 时间与 sha256；helper 以 `./project` 导出。随 skill 提供 formats、narrative 和五份 research 策略，注册时附安装目录及 helper 路径。完整项目初始化空 groups.json，无拼图亦有可校验摘要。MinerU v0.5.9 帮助已核对，PDF 为位置参数，`-f md,json` 为输出格式；补充材料单独输出，未因此调用云端服务。
- **SmartJC 适配**：五份 research 策略原文复用；common、逐页证据、汇总、讲稿组织与分页规则合并成 narrative.md，将私有 Claim/Source/Speech ID 和结构化页面返回改为 markdown、页码、panel ID。保留科研语义，移除候选应用审批及重复应用编排，不建立新的流程引擎。
- **官方 Remote 生成器**：使用匹配版本的 Typert generator；独立包构建阶段在 node_modules 缓存中建立临时 packages/ 与 tsconfig.host.json，复制本包源码及已安装的官方声明，改写暂存声明路径后用官方 WorkspaceAnalyzer/FaceModelEmitter/writePackageArtifacts 生成包贡献。仅分析本包 host face；不手工伪造 wire descriptors、不引入宿主源码仓库依赖。
- **host 边界**：JournalClubService 的 updateFigures/pageInfo 声明 sessionId 资源访问，经宿主会话 cwd 解析路径；词法和 realpath 双重检查阻止越界及符号链接逃逸。图源保存复用唯一 CAS/快照服务，页图尺寸来自真实旋转后 PDF，client 不猜页面大小。
- **工作台与入口**：补分页读取、cwd/一级子目录发现、宿主预览入口、移动/增删/改标签/放大编辑与页图裁切预览。聊天卡片使用 jc-card 标记，按钮经宿主 conversation 服务回流标准指令；借用会话作用域的访问方式后续按 D22 修正为 `scope.get('conversation').send(text)`。旧设计中的 agent.followup 不是已核实 API，已替换。卡片不持久化状态、不构成确认；重新识别直接经 update_figures 更新，监督仍是 diff、高亮与快照。
- **桌面实测修复**：host 显式依赖 sessions；client 挂载官方 contribution 后，在 remote.journalClub 的依赖作用域使用服务。补齐这两层依赖并冷启动宿主后，真实 PDF 页尺寸和图源写入可用。聊天卡片设置 groupTree=turn，避免被宿主折叠到步骤过程；不替换原生消息，宿主可能仍显示 jc-card 标记原文。新增 Panel 模式不让旧框拦截拖选；切项目重挂编辑器，页图重载清理拖动状态；裁切预览显式裁掉 bbox 外像素。
- **发布包**：共享声明块使用 shared- 前缀，避免占用公共 types.d.ts 名称；真实 tarball 消费者在 strict、skipLibCheck=false 下通过。移除仅构建 host 且会清掉 client 的不完整 build:watch；npm test 先完整构建，host 测试验证正式产物。
- **本次验证与边界**：85/85 回归、typecheck、构建通过；真实桌面探针验证非法引用拒写、agent 修正后 watch 更新、UI 移动/角缩放/在旧框内新增 Panel 的 CAS 保存与快照、聊天卡片摘要和宿主 Markdown 预览，详见 [开发验收](verification/development-acceptance.md)。dsh-ppt-maker@1.0.0 真实 create/edit/check/export 两页导出通过，图片与讲者备注已核对，见 [PPTX 集成](verification/pptx-integration.md)。这些证据不等同于三篇论文全流程、PPTX 视觉质检或新论文冷启动；M6 仍未完成。

被否：为初始化另加第六工具；为状态与卡片引入私有持久库；手写 Remote 协议描述；照搬 SmartJC 候选审批；在缺乏页面/导出证据时宣称 M4–M6 完成。

## D20 PPT 工具懒加载（2026-10-29）

- **已核实**：只读检查桌面已安装的 `dsh-ppt-maker@1.0.0` 发布源码，`armLazyTools` 在 `ppt-maker` skill 成功调用后注册 11 个 `ppt_*` 工具；初始工具列表缺少这些工具不能证明插件未安装。
- **决策**：渲染编排先调用已安装的 `ppt-maker` skill，再发现实际工具并读取 schema。加载失败或激活后工具仍不可用时报告实际错误，仅在确认未安装时提供安装引导；不增加工具或状态层。
- **验证边界**：最初依据安装包源码；2026-10-30 独立工作区真实会话已成功加载 skill、调用 PPT 工具并导出 24 页，见 [M6 记录](verification/m6-cold-start.md)。预览异常与质量边界见 D23，不据此宣称完整 M6 通过。

## D21 独立论文工作区与真实解析格式（2026-10-29）

- **实测**：M6 首次选用源码仓库及已有 `out/` 子目录，出现宿主沙箱权限问题，不符合普通用户的论文工作区场景。改在仓库外仅含 PDF 的独立工作区发起，已生成分析、图源与确认卡片；完整验收仍未完成。
- **接口差异**：v0.5.9 帮助声明支持 `-f md,json`，真实请求却返回 `field "formats" is invalid`。同版本单独 `-f json` 已完成该论文全部 18 页解析，返回 398 个 block，不能由组合格式失败推断 JSON 完全不可用。skill 改为分别请求 md 与 json，并复用已有产物；单格式仍失败时才记录实际缺口并视觉定位，不静默伪装解析成功。
- **图源纠偏**：首轮模型将 40 个原文字母 Panel 合为 20 个裁切单元，并在报告残余裁切缺陷时留下空 flags。skill 明确逐标签保留图源身份、保留完整图注、将未解决疑点写入已有 flags；合图继续使用既有 compose_panels，不增加新工具或状态层。
- **证据边界**：见 [M6 冷启动验收](verification/m6-cold-start.md)。后续已完成单篇开发测试导出，图源质量和修订后全新会话回归仍未通过；不能以本次人工纠偏替代冷启动能力证明。

## D22 借用会话作用域的服务访问（2026-10-30）

- **实测**：独立工作区的大纲确认卡片点击后报 `cannot get property "conversation" without inject`，消息未发送。插件已声明全局 conversation 依赖，但 `sessions.scope()` 返回宿主所有的借用 Context，不继承调用插件的注入声明。
- **适配**：按宿主 ui-conversation 的实际实现，使用 `scope.get('conversation').send(text)`，保留服务对目标会话 Context 的绑定；卡片与工作台复用一个薄发送函数。会话或服务已释放时明确报错，不自行创建会话或绕过宿主发送接口。
- **验证**：真实 Cordis Context 回归先复现直接属性读取失败，再确认 get() 发送时仍绑定指定会话；缺失 scope/服务测试通过。桌面重测结果见 [M6 冷启动验收](verification/m6-cold-start.md)。

## D23 PPTX 内容完整性与预览异常（2026-10-30）

- **实测**：独立工作区真实会话已导出 24 页。首版页数、图片数与备注数均正确，但第 3–24 页备注被模型压缩，违背 deck 唯一内容源；只数备注不能发现该问题。正常重新导出后，按 slide→notesSlide 关系逐页比较，24 页讲稿与 deck 全文一致（仅去 Markdown 格式并归一化空白），30 张引用图片字节均保留。
- **外部差异**：`ppt_render` 预览明显放大并截断。独立 PowerPoint 受保护视图抽查第 1、4、7、8、15、20 页，未复现该比例异常；暂不据此推定具体底层原因，也不通过缩小内容去补偿错误预览。
- **决策**：skill 明确备注只复制不摘要，导出后核对逐页正文；异常预览使用可用的独立查看器复核。结构、语义、视觉分别记录，XML 几何不代替目视检查。沿用外部 PPT 能力，不自建转换器或渲染器。
- **边界**：首版上述六页仅为抽查，当时邻图残影明显、来源脚注偏浅。后续 revision 341 的 24 页已在 PowerPoint 逐页检查；后续脚注定向复验与最终备注全文比对通过，三篇完整流程未通过。版本证据及复核脚本见 [M6 记录](verification/m6-cold-start.md)。

## D24 裁切逐边修正与整图兜底（2026-10-30）

- **实测**：上一轮“只外扩”的局部修复被保留为项目全局约定，造成邻图轴标题、字母反复串入。独立人工对照原页，Figure 2/3 等可收紧；Figure 1/4/5/6 的部分自身轴标题与相邻字母交错，简单矩形不能同时无残影且完整。候选边界若截断自身标签，不应用。
- **决策**：只外扩缺失自身内容的边，能安全收紧的边收紧；不可分离时停止循环，保留字母 Panel 身份和疑点，使用同一 region 的 whole-Panel 作为整图参考。沿用现有字段、update_figures/CAS、crop 和快照，不新增识别算法、工具或遮罩。整图兜底不算作独立切分成功。
- **源文件差异**：Figure 4C 浅色“Density”在 PDF.js 与独立 Poppler 整页渲染中均存在，记录为原 PDF 痕迹，不擦除科研像素伪装修复。
- **验证边界**：本次人工修正不冒称模型自动切分成功；按 D28 允许其作为正常人工核对环节，≤2 轮仅作效果记录。派生 deck/PPTX 必须同步并重新核验，见 [M6 记录](verification/m6-cold-start.md)。

## D25 区分渲染 fixture 与全流程论文范围（2026-10-30）

- **实测**：固定渲染样本 `2605.13902.pdf` 的摘要明确自称 Review，并非原创研究；旧 fixture 表误称研究论文。渲染测试有效，但不能据此要求完整流程突破产品范围。
- **决策**：保留原三份 PDF 作为固定底层回归；综述另做完整流程拒绝用例。M6 正向样本采用其余两篇原创研究，加现有公开机制研究 *The conserved noncoding RNA ModT coordinates growth and virulence in Clostridioides difficile*（DOI 10.1371/journal.pbio.3002948）；aging 样本单列新论文演示。仍需三篇正向全流程，不减少验收数量。所有论文流程在独立工作区执行，原件只读。
- **边界**：样本准备与范围核对不等于已完成真实模型流程，执行情况逐篇记录。

## D26 工作台未提交编辑与监听并发（2026-10-30）

- **桌面复现**：独立 `interaction-probe` 中，用户正在输入 `A_manual`，外部经 update_figures 把标签写成 `A_agent`（revision 1→2）；watch 静默替换输入框并因重新清空页图使弹窗滚动回顶部。服务器 CAS 正常也无法保护尚未发出的客户端编辑。
- **修复**：输入框只保留当前未提交值，提交函数绑定开始编辑时的 revision；拖框和删除/排除确认同样保留操作开始时的提交函数。监听继续更新文件视图，但不清空同页图像和在途拖框；冲突在放大弹窗内也显示，不静默重试覆盖。没有新增持久状态或工作流。
- **验证**：真实 React 组件回归覆盖输入保留/冲突/显式重试、删除确认期间变更、拖框期间变更。90/90 固定回归、类型检查及构建通过；桌面复测结论见 M6 记录。React renderer 仅为开发测试依赖，客户端仍使用宿主 React。

## D27 宿主命令启动失败不能当作解析降级（2026-10-30）

- **实测**：独立 QCIC 冷启动的 shell 在执行 CLI 前因 `SetNamedSecurityInfoW failed (Win32 5): grantWrite` 失败。模型随后仅靠页图生成 analysis 与 39 个 Panel，没有复制项目内 main.pdf，也没有 MinerU 产物；这不满足已请求的高精度流程。
- **决策**：区分宿主启动错误与解析服务错误，使用宿主正常的逐命令授权/重试路径；不修改项目或上级目录 ACL，不据此推断 MinerU 不可用，也不静默改用视觉阅读。保留部分产物，依赖解析的完整流程等待恢复；更改解析要求需说明差异并取得用户新请求。规则只进入 skill，不增加权限模块或新工具。
- **边界**：QCIC 当前停在复制 PDF 的宿主命令审批；本条修订尚未通过审批后的新会话重测。

## D28 按人机协作场景验收模型输出（2026-10-30）

- **用户校正**：模型能力有限，不应过分严苛；产品保留手动调整和人工检查正是为此。
- **决策**：M6 以真实流程、三个确认点、文件一致性、人工修正能力和可用 PPTX 为主。首轮可用率、迭代轮数单独记录，不设模型必须完美或 ≤2 轮成功的硬门槛。正常人工调框、内容纠错、保留疑点和整图展示可计入完整流程；不把人工修复写成模型自动成功。
- **范围**：优先修影响使用的缺图、关键标注截断、错误引用、明显结论错误及系统缺陷。细微邻图边缘、非主线内容细节和原文本身疑点如实保留，避免无止境微调或为提升模型效果新增架构。未完成的三篇流程和 PPTX 仍须执行，不能仅凭本条将 M6 标为完成。

## D29 PPT 图片等比适配（2026-10-30）

- **实测**：QCIC 宿主编排发现图片虽设置适配意图，仍被导出路径按元素框拉伸。模型按实际图片宽高比修正 PPTD 图片框后，默认导出检查 0 问题；最终 17 页 PowerPoint 放映未见比例失真，见 [QCIC 验收](verification/m6-cold-start/qcic-source-audit.md)。不据此推定外部插件所有版本都忽略同一选项。
- **决策**：沿用外部 PPT 工具，在编排层让图片框本身保持源比例，并复验实际导出。skill 和 deck 对接文档补充这一规则；不自建适配器、渲染器或修改科学图像。

## D30 实现收敛：crop 单次回写、残留锁回收、校验同源（2026-10-30）

- **问题**：架构复查发现三处缺陷。crop 遇任一异常即整批不回写、删除暂存 PNG，却仍在 `cropped` 中报告资产路径，agent 会把旧图当成新裁结果；crop 每个 panel 单独写一次 revision，全量裁切产生 N 份快照，按 10 份滚动会冲掉切分阶段的 `.history`；`.lock` 写入了 pid 却无人检查，进程崩溃后的残留锁让之后的写入全部超时。
- **决策**：crop 将本次新资产路径合成一个 patch，经同一写入入口回写（至多 revision+1）；已登记 asset 的 panel 只在 revision 未变时替换像素，不增加版本。异常项列入 anomalies，不阻断其余 panel，`cropped` 只列实际落盘的资产；写入冲突时丢弃暂存图并报错。锁逻辑合并为 `src/fileLock.ts`，figures.json 与 groups.json 共用；锁内容记录的 pid 已退出，或锁内容为空/不可解析且超过 5 秒（含旧版 compose 留下的空锁），即回收；删除前复读锁内容以缩小多进程同时回收的竞态，仍属尽力而为。rename 落盘失败时，本次新登记但未落盘的 asset 尽力撤回。
- **同源**：validate 复用 `figuresJsonIssues`（与 update_figures 写入前校验同一规则，原先两套规则不一致，validate 漏查负坐标和 asset 路径）；groups.json 解析与成员指纹集中在 `src/groups.ts`，compose_panels 与 validate 共用同一算法。MinerU 换算 `mineruBBoxToPt`/`parseContentList` 经 `./project` 导出，skill 改为调用 helper，不再手算。client figures 类型改由 zod schema 推导。
- **顺带修正**：validate 工具摘要原先把 errors 与 warnings 混排、无法区分，改为分组标题；不再随包发布无法独立运行的 `src/tools/composePanels.ts`、`src/layout/**` 源码（其依赖未随包，运行时只用 lib）。
- **保留**：自研 RFC 6902 patch 与 jc.md frontmatter 解析不换成第三方库——两者已有安全检查与回归，换库仍需自写 revision 保护与严格度约束，收益有限且新增依赖。三处 frontmatter 解析严格度不同（jc.md 严格、deck/状态卡宽松），合并会改变容错行为，暂不合并。jc.md 的 `figures_revision` 处理见 D31。
- **验证**：106/106 回归（新增 crop 部分异常单次回写、落盘失败撤回 asset、残留锁回收、compose/validate 指纹一致、跨字段违例报告、validate 摘要分组六项；移除无调用方的 `pageSizeFromImage` 用例）、typecheck、build 通过；未在真实宿主重测。

## D31 jc.md 移除 figures_revision（2026-10-30）

- **问题**：jc.md 的 `figures_revision` 与 `confirmations.figures.revision`、figures.json 的 `revision` 重复。代码与状态卡均不读取它，确认有效性只比对确认记录与 figures.json；它只会在图源变更后过期，违背「文件即真相」。
- **决策**（用户确认彻底删除）：jc.md 契约不再包含该字段，helper 不再接受、校验或写出它。figures 版本只存在于 figures.json 与确认记录。outline.md/deck.md frontmatter 的 `figures_revision` 是另一契约（validate 据此提示引用旧版本），保持不变。
- **兼容**：jc.md 解析本就忽略未知键，旧项目中遗留的字段可照常读取，下次经 helper 写入时自然移除，无需迁移。
- **同步**：[对话入口](product/对话入口.md) §5 示例、skill 的 formats.md 与 SKILL 字段清单；新增遗留字段兼容回归。

## D32 图源编辑按容器宽度采用两栏（2026-10-31）

- **问题**：用户手工测试发现原页、裁切预览和操作纵向堆叠，常用工具被推离视口；放大窗口沿用单栏结构，未有效利用横向空间。
- **决策**：保留 Figure 连续浏览；宽编辑器采用左画布/右预览属性，窄侧栏保留单栏与放大入口。标签和删除放在预览上方，Panel 导航单行横滑、添加固定，低频图级操作收入文字菜单。原生 dialog 复用现有组件与即时写入/CAS，不移植 SmartJC 三栏整体、保存事务或状态库。权威规格见 [图源核对 §3](product/图源核对.md#3-工作台figure-连续核对列表)。
- **后续手测修订**：用户在宿主加载两栏后反馈预览偏小，增加局部分隔条（参考 SmartJC 的指针捕获/限幅/键盘交互，适配为比例），宽布局预览随栏宽增长，不再固定高度；比例不进文件或持久化配置。
- **验证**：类型检查、构建、108/108 回归和独立 Edge 的宽/窄/较矮窗口、长图注、200% 拖框、原生模态与分隔条通过；新增分隔条待宿主手测。Gemini 对首轮两栏源码的评审意见与本地核对分别记录于 [两栏布局验收](verification/ui-layout-20261031.md)。

## D33 跨页图注不能只取 image_caption（2026-10-31）

- **问题**：牙龈论文 Figure 1–6 的后续图注已被 MinerU JSON 识别为下一页页底 `page_footnote`，却没有进入 Markdown/image_caption。既有图源和分析错误地将漏读续文判定为源 PDF 截断，30 个 Panel 缺少关联。
- **决策**：流程规则进入 skill：遇到断句或后部 Panel 无图注时，检查相邻页与页底块并核对 PDF，核实后补全句子和引用；caption.page 保留起始页，完整页码范围记入分析。此行为属于完整图注恢复，不新增跨页图像编辑或自动拼接算法，不修改 schema。
- **验证**：本样本六处续文逐页目视核实，经既有写入通道一次 CAS 修复；保留手工框、标签、资产与补充图，纠正分析原段落。新 skill 规则的另一篇模型冷启动尚未验证，详见 [跨页图注核验](verification/caption-continuation-20261031.md)。

## D34 工作台改框后立即重裁（2026-10-31）

- **问题**：用户发现工作台预览与 LLM 所见位置有偏差。只读诊断（6 个真实项目逐 Panel 模板匹配）显示坐标换算与渲染一致（误差 ≤1 个页图像素），偏差来自资产过期：牙龈论文 54/91 个 Panel 的 `figures/<id>.png` 与当前框不符，恰为全部 54 个 `origin: manual`。工作台拖框只经 update_figures 改 bbox，不重裁；工作台从页图按新框显示，agent 读取的仍是旧框裁出的 PNG，validate 只查文件存在。
- **决策**（用户选定方案 A）：host 增加 `cropPanels` Remote，复用 crop 工具抽出的 `cropFigures`（同一路径边界、单次回写与 CAS 检查）。工作台在移动/缩放/新增 Panel/补图保存成功后重裁对应 Panel；标签、删除、排除不重裁。新增 Panel 等重裁与刷新完成后再聚焦标签，标签提交使用重裁后的 revision。重裁失败不回滚框，就地提示，确认图源时全量重裁兜底；旧宿主无该方法时工作台跳过重裁。
- **不做**：不在 update_figures 内隐式裁切（保持工具原子化）；不加资产与框的溯源字段。已过期的现有资产不自动修复，需对该项目运行一次 crop。
- **验证**：113/113 回归（新增真实 PDF 重裁与像素随框变化、路径边界、工作台重裁调用与失败提示、新增 Panel 标签不冲突），typecheck、build 通过；未在真实宿主复验。诊断脚本见 `out/align-check.mjs`、`out/stale-check.mjs`（未入库）。

## D35 自由拼图页面与共用几何导出（2026-10-31）

- **用户决定**：自由拖动拼图，不限制画布比例和图片数量；系统建议可采纳但不覆盖手调。撤销此前讨论中的固定 16:9 与四图上限，两者不是产品约束。拼图是 PPT 中的一块图片素材，导出边界由图片外缘确定，不要求先设置固定画布。
- **实现**：JC tab 新增自由拼图页面，原生 SVG/Pointer Events + 本地编辑草稿，图片拖动/等比缩放、默认适应模式自动跟随图片外缘（手势中冻结、结束后取景）、外缘自动导出、查看全部图片、建议排版、撤销重做、保存与放大。SmartJC 的分区评分规则继续复用，改为支持任意正成员数与画布尺寸；不搬分区树、三栏结构或持久状态库。
- **素材修订**：用户在宿主反馈纯编号列表难选图，右栏改为默认「素材」与「属性」标签。素材完整缩略图按 Figure 分组，预览与添加按钮分离，已加入卡片保留并可定位；原生大图预览支持原图尺寸，关闭归还焦点与滚动位置。按需读取已有 PNG，无新后端服务。Gemini 3.8 Flash 再次评审该交互，采纳热区分离、稳定占位和焦点恢复建议。
- **文件与并发**：保留 groups.json version 1 与 layout.geometry，增加 manual 几何入参；UI/工具共用 composePanels，host 的两个 Remote 仅提供会话内载入/保存，官方 Typert 生成协议。文件摘要和图源内容摘要拒绝过期保存，草稿保留。导出沿用 sharp 与稳定 PNG 路径；工作台默认 2 倍像素。没有新增流程工具或审批点。用户进一步确认左栏滚轮直接切组；改裁切沿用原图源核对页，返回后刷新素材保留排版及撤销历史，读取成功后自动保存并重建当前拼图，其他受影响图组只标记待更新。并发版本只在保存成功后推进，不新增界面或自动级联任务。对话协作采用用户确认的单个「加入对话」按钮：复用宿主 inputActions 将明确图组与文件引用放入当前会话草稿，未保存时先保存，不自动发送或持续同步选中状态。AI 写入 groups.json 后由宿主文件通知自动更新已保存布局和缩略图，保留选中项；有未保存手动修改时保留草稿并使用原有重载入口。已有图组在文件清单中原位更新，新建才追加；页面顺序以 deck.md 首次引用为准，无文稿才用清单顺序。移除引用、清单条目或 PNG 的旧图不再显示，新建未引用草稿暂留会话末尾；列表过滤不删除磁盘旧文件，不引入单独的排序存储。修改保留原 ID 和 asset，工具默认只更新已登记输出；只有明确新建/另存传 create:true，且拒绝覆盖。加入对话携带固定输出约束，不根据成员相同自动合并。经用户指定的旧重复产物单独核对引用并备份清理，不引入自动清理服务。
- **Gemini 评审**：通过 agy CLI 的 Gemini 3.8 Flash 讨论页面，采纳错位新增、空白取消选择、单手势撤销、贴合图片范围；不采纳选中即改导出层级。此前 Gemini 的固定四图建议已被用户明确否定，不作为实现限制。
- **验证**：见 [自由拼图验收](verification/free-composition-20261031.md)，区分自动化、独立浏览器与宿主验收状态。

## D36 工作台写入排队、读取失败保留草稿（2026-10-31）

- **问题**（全面检查发现，已对照代码与回归复现）：① 改完标签直接拖框时，标签失焦提交占住写入，拖框松手若在其完成前即被静默丢弃（框弹回），若在其后则以旧版本提交被当作外部修改报冲突；② figures.json 一次读取失败（如 agent 写入期间分页读到不同版本）即清空图源，工作台与拼图编辑器卸载，未提交标签和拼图撤销历史丢失，违背 D26 与自由拼图「刷新失败保留草稿」；③ 补图页的页图随每次文件刷新被清空重读，拖框中断。
- **决策**：工作台写入改为串行排队，不再丢弃；记录本端写入的版本推进（仅限不改 Panel 下标的 patch：替换、追加到末尾，以及重裁登记 asset），排队的编辑据此跨过自己的写入，外部修改和删除仍由 CAS 报冲突。`cropPanels` 结果增加 `base_revision`，使重裁推进的版本可被精确识别，夹入的外部写入不会被误认作本端。store 对读取失败重试一次；仍失败时保留上一份 figures.json/jc.md 并提示，解析失败（内容损坏）与文件不存在维持原清空语义。补图页只在换文档/换页/手动重读时清空页图。确认图源时先对全部未排除 Panel 运行 crop，再读取 revision 写确认记录，落实 D34 所说的全量兜底。
- **不做**：不引入草稿持久化、写入事务或状态库；拼图编辑器按下未移动时的外部重载、跨图报错清除、每次刷新重读全部页图等风险留待后续。
- **验证**：141/141 回归、typecheck（含未使用变量检查）与构建通过。新增用例在修复前代码上失败：标签写入进行中拖框（未修复时拖框被丢弃）、两次本端写入间夹入外部修改仍报冲突、读取瞬时失败重试、重试仍失败保留上一份、文件不存在不重试、补图页刷新不清空页图。真实 store 异步读写下新增 Panel 后改标签的用例在修复前同样通过，只作为端到端行为保护，不证明修复本身。未在真实宿主复验。

## 修订记录

- 2026-10-26：初版（D1–D13）。
- 2026-10-28：D14（M1 实测结论与实施偏差）。
- 2026-10-28：D15（M2 图源写入与校验实现默认值）。
- 2026-10-29：D16、D17（M3–M5 实施状态，Remote 写入边界）。
- 2026-10-29：D18（桌面宿主实测：client 加载契约），同步修订 D12/D14/D16 与架构 §1.3、§2、§5 的样式描述。

- 2026-10-29：D19（文件初始化、随包 skill/helper、官方 Remote 生成与工作台/卡片集成收口；验收边界分列）。
- 2026-10-29：D20（PPT skill 激活先于工具可用性检查）。
- 2026-10-29：D21（独立论文工作区、分格式解析及 Panel 身份与疑点标注）。
- 2026-10-30：D22（借用会话 Context 的服务访问与确认按钮修复）。
- 2026-10-30：D23（完整讲稿比对、异常预览的独立核对与验收边界）。
- 2026-10-30：D24、D25（逐边裁切与整图兜底；渲染样本与全流程适用范围分离）。
- 2026-10-30：D26（工作台编辑中遭遇文件监听更新时保护输入并使用原 revision）。
- 2026-10-30：D27（宿主命令启动失败与解析服务失败分开处理）。

- 2026-10-30：D28（按用户确认的人机协作场景调整 M6 验收口径）。
- 2026-10-30：D29（外部 PPT 导出图片框按原图比例适配）。
- 2026-10-30：D30（crop 单次回写与结果一致、残留锁回收、validate/compose 规则同源，同步修订 D15 与架构 §2、§3、§8）。
- 2026-10-30：D31（jc.md 移除冗余的 figures_revision，同步修订对话入口 §5、formats.md 与 SKILL）。
- 2026-10-31：D32（图源编辑宽区两栏、窄区单栏，保留现有文件与编辑语义）。
- 2026-10-31：D33（核对 page_footnote 等跨页图注续文，避免将漏读误判为源文件截断）。
- 2026-10-31：D34（工作台改框后经 host 重裁对应 Panel，修复 agent 所见资产与工作台框不一致；同步修订图源核对 §3/§4、架构 §5）。

- 2026-10-31：D35（任意比例/图数的自由拼图页面，复用 compose 核心并保护手调草稿）。
- 2026-10-31：D36（工作台写入排队与跨本端版本、figures.json 读取失败保留、补图页图不随刷新清空、确认图源时先全量重裁；同步修订图源核对 §4/§6、架构 §4.1 与当前状态、SKILL）。
