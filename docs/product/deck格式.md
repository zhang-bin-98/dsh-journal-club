# deck.md 格式草案（v1）

> 隶属 [产品设计](产品设计.md) 4.5 的产物契约细化。基于 2026-10 对 dsh 生态 PPT 插件的调研。

## 1. 生态调研结论

| 方案 | 输入契约 | PPTX 能力 | 对我们的适用性 |
|---|---|---|---|
| **dsh-ppt-maker**（OMSociety，MIT） | **PPTD YAML DSL**（`deck.pptd` + `pages/*.page` 工程）；模型经 11 个 `ppt_*` 工具操作 | 本地纯 TS 引擎直出 .pptx；规则+AI 质检；字体嵌入；逆向现有 pptx；右侧栏三栏工作台可视化微调 | **PPTX 主路径**：工具链最完整，工作台补上了我们 v1 不做视觉编辑的缺口 |
| **dsh-slides**（yeyupiaoling，MIT） | 结构化数据（布局 title/section/bullets/image/quote） | 自包含 HTML 幻灯片；PPTX 为大纲级（无母版无动画）；5 主题 | 布局无多图网格，不适合科研图组；备选 |
| **dsh-ppt**（yejiming，MIT） | 自然语言需求（一句话生成） | 原生可编辑 pptx、AI 视觉审稿、自动配图 | 面向职场创作场景，无文件契约，不适合程序化对接 |
| **dsh-np-ppt**（z953218350） | PPTD DSL 引擎 + python-pptx | 离线编译、可视化编辑器 | 同属 PPTD 阵营，佐证 PPTD 正成为生态中间契约 |

**关键发现：没有插件以 markdown 幻灯片为输入契约。** 生态中间件是 PPTD（YAML 工程，面向模型与工作台，不面向人读人写）或结构化数据。

**由此确定的对接策略**：
- `deck.md` 定位为**人类可读的内容契约**——给用户预览/编辑（dsh markdown 预览 + 任意编辑器）、给 `validate` 校验、给 agent 阅读。不要求任何插件直接消费它。
- **deck.md → PPTX 由 agent 完成**：agent 读 deck.md 与图片文件，调用 dsh-ppt-maker 的 `ppt_create` / `ppt_edit` 构建 PPTD 工程，`ppt_check` 质检、`ppt_export` 导出。markdown→YAML 的翻译正是 agent 擅长的工作，**不写转换器代码**（符合工具原子化与 agent 信任原则）。
- 装了 dsh-ppt-maker 的用户还获得右侧栏 PPT 工作台的视觉微调能力——正好补 v1「不做视觉级编辑」的缺口。
- 该编排写入 skill（推荐路径 + dsh-slides/手动 PowerPoint 备选），使用说明注明。

**外部接口核实（2026-10-29）**：已只读检查 npm `dsh-ppt-maker@1.0.0` 发布包：create 接收 dir，edit 接收 dir/ops/baseRevision，check 接收 dir/pages/ai，export 接收 dir/out/skipCheck；页面 notes 会写入 PPTX 讲者备注。这是接口核实，不是本项目真实导出验收，使用时仍读目标宿主工具 schema。

## 2. 格式规范

### 2.1 文件与引用

- 文件位于项目文件夹根部 `deck.md`；图片引用使用**相对路径**（`figures/xxx.png`、`groups/xxx.png`），dsh markdown 预览原生支持渲染。
- 图片文件名 = figures.json 中的稳定 ID（Panel 级）或拼图模块产物 ID（图组级）。

### 2.2 总体结构

- YAML frontmatter：全局元数据。
- 页与页以 `---`（thematic break）分隔——沿用 Marp 等通用 slide-markdown 惯例，dsh 预览中渲染为分隔线不破坏阅读。
- 每页三部分：**页头注释**（结构元数据）→ **正文**（标题/要点/图片/来源标注）→ **讲稿引用块**（预览可见）。注释是否隐藏取决于宿主 Markdown 渲染器；2026-10-30 桌面实测中注释以原文显示，不影响分页解析，不另建渲染器。

### 2.3 页头注释

```html
<!-- page 3 · layout: figure-text -->
```

- `page N`：页号，须与 `---` 切分顺序一致（validate 检查，防人工编辑错乱）。
- `layout`：布局建议，枚举继承 SmartJC 六布局：`title` / `text` / `figure-full` / `figure-text` / `two-figures` / `panel-grid`。它是对 agent 转换 PPTD 的提示，不是硬约束；允许省略（agent 自行判断）。
- 未知字段忽略（向前兼容）。

### 2.4 正文

- 页标题：`#`/`##`（标题优先准确结论句——叙事规则由 skill 保证，格式不强制）。
- 要点：无序列表。
- 图片：标准 markdown 图片语法，alt 写图号/Panel 标签。
- **来源标注**：每张图下一行引用块 `> 来源：Figure 3B · p.12 · 补充材料`（文件角色可选）。
- 疑点：需要标注时在相关内容行内使用 `⚠️`（与 outline.md 疑点标记一致）。

### 2.5 讲稿

每页末尾固定标记的引用块，可多行：

```markdown
> 🗣 **讲稿**：这一页我们看主要终点的结果。联合用药组 ORR 达到 62%，对照组为 34%……
> 注意生存曲线的分离从第 8 周开始，这与机制预测的起效时间一致。
```

- 选**可见引用块**而非 HTML 注释：预览时讲稿与页面内容图文对照（符合「讲稿与页面相互配合」的产品目标）；人工编辑不易损坏；`validate` 与 agent 按固定标记提取，转 PPTX 时写入对应页讲者备注。
- 转换时完整保留已确认讲稿，只去除 Markdown 格式，不摘要或改写。导出后逐页比对备注正文；备注数量齐全不代表内容完整。

## 3. 完整示例

```markdown
---
title: 联合治疗克服耐药：一项 II 期随机对照研究
paper: main.pdf（+ supplement.pdf）
figures_revision: 3
generated: 2026-10-26
---

<!-- page 1 · layout: title -->

# 联合治疗克服耐药：一项 II 期随机对照研究

**Journal Club** · 2026-10-28

> 🗣 **讲稿**：今天分享的是 XXX 团队今年发表在 Nature Communications 的 II 期临床研究……

---

<!-- page 2 · layout: figure-text -->

## 研究背景：耐药机制 X 驱动治疗失败

- 既往治疗失败多伴随 X 通路上调（临床队列验证）
- 临床前模型提示：A 药 + B 药协同抑制

![Figure 1A](figures/fig1_A.png)
> 来源：Figure 1A · p.6

> 🗣 **讲稿**：背景部分请大家关注 Figure 1A 的队列数据……⚠️ 该关联为回顾性分析，因果解释需谨慎。

---

<!-- page 7 · layout: panel-grid -->

## 主要终点：联合组 ORR 近翻倍

![组合：Figure 4 A-D](groups/fig4_AD.png)
> 来源：Figure 4 A–D · p.15

> 🗣 **讲稿**：这一页组合展示了 Figure 4 的四个 panel。瀑布图可以看到……
```

## 4. 解析与校验（validate 工具）

按 `---` 切页 + 页头注释解析，校验：

- 页号连续且与切分顺序一致；
- 图片引用文件存在且有身份：单图在 figures.json 的 panel asset 中；**组合图在 groups.json 中展开为成员 panel** 后检查（组合图不存在或成员无效 = 错误）；
- **每页有讲稿块（缺失 = 错误，阻断渲染**——讲者备注是交付承诺）；讲稿提及图号但页内未放图 / 页内放图但讲稿未讲 = 提醒；
- 图组成员被重裁（groups.json 的 inputs_digest 与当前 panel 资产不匹配）= 提醒重建拼图；
- 来源标注格式合法。

发现覆盖等语义检查不归程序（自由文本无发现 ID）——由 agent 在确认前对照 analysis.md 发现清单自查（见产品设计 4.6 分层）。

## 5. PPTX 对接路径（写入 skill 的推荐编排）

完整流程开始时创建空 `groups.json`（`{"version":1,"groups":[]}`，仅不存在时创建）。无拼图也使用实际文件摘要；已有图组不可覆盖为空。

0. **渲染门槛（确认点 3）**：PPTX 渲染是分钟级昂贵操作，仅在用户确认 deck.md 内容与拼图效果后启动——用户在秒级 markdown 预览中核对每页内容、讲稿、组合图；拼图不满意 → 对话重拼（`compose_panels` 秒级重跑，组合图文件名稳定，deck.md 引用不变自动刷新）。确认动作写入 jc.md confirmations（deck digest + groups digest——文件或图组变更即确认失效）。skill 约定 agent 不跳过该确认直接渲染（用户显式说"直接渲染"除外）。
1. 先通过宿主 skill 工具调用已安装的 `ppt-maker` skill，再发现实际 `ppt_*` 工具并读取 schema → agent 读 deck.md + 图片 → `ppt_create`（学术主题）→ `ppt_edit` 逐页建元素（文字原生、图片引用、布局按 `layout` 提示）→ 讲稿写入每页备注 → `ppt_check` → `ppt_export`；用户可在其右侧栏工作台继续视觉微调。v1.0.0 在 skill 成功调用后懒注册工具，初始工具列表缺少 `ppt_*` 不能作为未安装的判断，见 [D20](../decisions.md#d20-ppt-工具懒加载2026-10-29)。
2. skill 加载失败或激活后仍无工具 → 如实报告能力错误；确认未安装时才建议安装。无法继续时可用已可用的 dsh-slides 生成 HTML 版（布局能力降级），或用户手动。
3. deck.md 是唯一内容源；PPTD 工程是它的派生物，内容修改一律改 deck.md 后重新生成，不双向同步（方向单一，避免分叉）。
