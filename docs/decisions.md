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
2. **乐观锁与并发**：`base_rev` 必须是非负整数；写入时在独占 `.lock` 下重新读取当前文件并比较 revision，进程内同一路径再串行排队。匹配才应用 patch；冲突返回结构化结果，不改主文件、不生成快照。
3. **快照**：成功替换前写入项目 `.history/`，保存旧 figures.json；默认保留最近 10 份，超出滚动清理。主文件采用临时文件完整写入后 rename；快照或主文件写失败均不推进 revision。
4. **跨字段校验**：写入前除基础 schema 外检查 document/figure/panel ID 唯一、region/document/page 引用、region_index、caption_refs、asset 身份与有限非退化 bbox。crop 的 asset 回写也通过该唯一写入服务，避免第二套写入口。
5. **validate 分层**：程序只报告确定性 `errors`/`warnings`；deck 页头、页号、来源、图片身份、图组成员、讲稿缺失属于 error；旧 figures revision、图组 digest 失配、Panel 未引用、图文讲稿不对应属于 warning；outline 只检查存在与 revision，不把发现覆盖和叙事质量伪装成程序判定。
6. **M1 安全收口**：工具相对路径按 dsh session cwd 解析；panel ID 拒绝路径穿越和 Windows 保留名；PNG 原子替换；PDF 缓存按 size/mtime/ctime 失效；render_pages 对清洗后可能碰撞的源文件名追加稳定短标识。

M2 验证：`npm run typecheck`、`npm test`（29/29）和 `npm run build` 均通过；真实 dsh 安装加载仍待宿主环境验收。

被否：仅依靠 `figuresJson` 的原子 rename（缺少 CAS/快照/patch 回滚）；让 crop 直接保存 figures.json（会绕过唯一写入通道）；由 validate 判断发现覆盖或科学因果表达（超出可判定契约）。

## D16 M3–M5 实施状态与验收边界（2026-10-29）

- **M3 文件链实现**：新增 `src/skills/journal-club/SKILL.md` 与 `src/project/jcState.ts`，覆盖完整/局部/恢复分流、MinerU manifest 四条件缓存、三确认点、jc.md digest/revision 失效与恢复停点；单元测试覆盖状态读写/确认有效性。真实 dsh skill registry 挂载与三篇论文纯对话端到端尚未验收。
- **M4 client 工作台实现**：新增 JC tab/store/workbench/样式表，覆盖空态/状态卡/图源工作台、workspaceFiles read/watch、bbox 框与四角编辑、图注关联、裁切预览和冲突提示；写入只调用约定的 `remote.journalClub.updateFigures`。client bundle 与 store/geometry 测试通过，但**host 侧 `journalClub` RPC 服务尚未注册，真实 dsh/browser 页面交互未验证**，故不能宣称 M4 端到端完成。
- **M5 compose 核心实现**：新增 `compose_panels`，支持 grid/rows/1+2、sharp 输出与 groups.json 成员/digest/几何登记；单测覆盖构图、缺失成员、重拼和输出契约。真实图片人工质量验收、与实际 dsh host 的加载尚未完成；PPTX 外部插件链仍未验证。
- **阶段总验收未完成**：没有真实 dsh 安装运行、JC 工作台人工交互、三篇论文全链确认/恢复或 PPTX 导出证据。以上作为 M6/宿主集成验收项继续跟踪，不以 typecheck/build 通过代替。

## D17 Remote 写入集成边界与未完成项（2026-10-29）

- M4 client 工作台调用约定的 `remote.journalClub.updateFigures`，但独立 npm bundle 没有 host Typert Remote owner；不能把该调用视为已接通。
- 调研 harness 官方 `TypertRemoteService` 与生成器：生成器要求 harness workspace 根目录同时有 `tsconfig.host.json` 和 `packages/`；`mode: package` 也走 `findWorkspaceRoot()`，不能在本仓库的独立 bundle 目录运行。NPM `@deepseek-ai/dsh-typert-generator@0.0.1-rc.1` peer Cordis 与当前 `4.0.6-alpha.1` 冲突；较新生成器依赖匹配，但仍有 workspace root 限制。
- 因此未手工伪造 Remote descriptors，也未用 `--force` 安装不兼容 generator；client 在 RPC 未提供时保持 fail-closed，禁止绕过 `update_figures` 直接写文件。
- **待宿主集成**：需要在 dsh profile/bundle 侧提供 Typert host/controller package face 与生成的 `./remote` contribution，再运行真实 Web/desktop session 验证读取、watch、CAS 写入和冲突 UI。当前 M4 只能标记为 client 实现已完成、真实写入链未验收。
- 最终自动门禁（2026-10-29）：typecheck、host/client build、49/49 测试与 `npm pack --dry-run` 通过；浏览器交互、三篇论文从冷启动到 PPTX 的完整链未执行。

## D18 桌面宿主实测：client 加载契约（2026-10-29）

在本机 DeepSeek Harness 桌面版（runtime 0.2.1-rc.3）上以 `dsh plugin --profile desktop add <本仓库>` link 安装后实测，暴露并修复两项 client 契约问题：

1. **工厂闭包内不能有 CSS import**：tsdown CSS 管线在工厂顶部产出 `import './style.css'`，渲染层报 `Cannot use import statement outside a module`，整个 web boot 失败（应用弹窗「1 entry did not activate」）。改为 `src/client/styles.ts`：`jc-` 前缀类名的样式字符串，`apply` 时注入一次 `<style>`，删除 `.module.css` 与 `@tsdown/css`。
2. **服务依赖要在模块级导出 `inject`**：在 `apply` 内调 `ctx.inject([...], cb)` 时，回调没有触发，tab 不出现，也没有报错。宿主内置插件（sidebar-files 等）都是模块级 `export const inject = [...]`，由 loader 等服务就绪后再调 `apply`。改为同样写法（`slots`、`sidebarRightTabs`、`remote`、`remote.workspaceFiles`）后，右侧栏引导出现「Journal Club」入口，点开后空态正常渲染，console 无错误。

- **已验证**：桌面版启动正常；插件出现在 boot entries；样式表已注入；JC tab 注册并渲染空态。
- **未验证**：真实 jc.md 项目的状态卡与工作台、watch 刷新、`update_figures` 写入链（D17 的 host RPC 仍未接通）、三篇论文全链与 PPTX。headless profile 用不了桌面账号 provider（`ACCOUNT_SIGN_IN_REQUIRED`），所以 agent 侧工具/skill 的真实调用要在桌面版对话里验收。
- 被否：保留 CSS Modules 再给工厂补 CSS loader（宿主没有公开这个契约）；在 `apply` 内轮询等服务（与宿主 loader 语义重复）。

## 修订记录

- 2026-10-26：初版（D1–D13）。
- 2026-10-28：D14（M1 实测结论与实施偏差）。
- 2026-10-28：D15（M2 图源写入与校验实现默认值）。
- 2026-10-29：D16、D17（M3–M5 实施状态，Remote 写入边界）。
- 2026-10-29：D18（桌面宿主实测：client 加载契约），同步修订 D12/D14/D16 与架构 §1.3、§2、§5 的样式描述。
