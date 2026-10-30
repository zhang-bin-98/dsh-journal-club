# 文档索引

> dsh-journal-club 权威文档入口。2026-10-30，M6 按人工协作口径完成：五个工具、skill 文件链、工作台与宿主集成已实现，101/101 回归、类型检查与构建通过。独立工作区已验证并发编辑保护、删除/排除、缺页恢复及手工补图回填；新版 UI 已在真实宿主验收。QCIC 17 页、空间组学 15 页、ModT 15 页完成三确认点及 PPTX 全流程，aging 24 页新论文演示已核验；备注全文、图片与 PowerPoint 检查证据分别记录，保留人工修正、整图概览和外部预览异常的边界。详见 [UI 修订记录](verification/ui-review-20261030.md)、[开发验收](verification/development-acceptance.md)、[M6 冷启动验收](verification/m6-cold-start.md)、[PPTX 集成](verification/pptx-integration.md) 和 [架构 §7](architecture/架构设计.md#7-分阶段实施计划)。

## 阅读顺序

1. **[产品设计](product/产品设计.md)**——产品是什么、闭环、形态、边界（15 分钟读完）。
2. **[架构设计](architecture/架构设计.md)**——技术选型、包结构、工具与数据契约、SmartJC 复用清单、M1–M6 计划。
3. 按需读细化文档：

| 文档 | 什么时候读 |
|---|---|
| [图源核对](product/图源核对.md) | 做核对工作台 UI / figures.json 交互（M2、M4） |
| [deck 格式](product/deck格式.md) | 做 deck.md 生成、validate、PPTX 编排（M2、M3、M5） |
| [对话入口](product/对话入口.md) | 做 skill 触发分流、恢复、jc.md（M3、M6） |
| [决策记录](decisions.md) | 想改某个设计、或好奇「为什么当时这么定」 |

## 文档一览

```text
README.md                      仓库门面（闭环、形态、路线图）
AGENTS.md                      人机协作工作约定
docs/
├── README.md                  本文件
├── decisions.md               决策记录（D1…：决策/理由/被否方案）
├── product/
│   ├── 产品设计.md             唯一产品权威：定位、三确认点闭环、形态、分步、边界
│   ├── 图源核对.md             确认点 1 的交互细化（右侧栏工作台）
│   ├── deck格式.md             deck.md 契约 + PPTX 生态对接路径
│   └── 对话入口.md             触发分流 / 恢复 / jc.md 状态与确认记录
├── architecture/
│   └── 架构设计.md             选型、包结构、5 工具契约、数据契约（figures.json / groups.json / manifest）、M1–M6
└── verification/
    └── m1-mineru-overlay/       M1 验收证据：MinerU bbox 叠加对齐图（2026-10-28）
```

## 术语速查

| 术语 | 含义 |
|---|---|
| dsh / DeepSeek Harness | 运行平台：插件化 agent harness，本插件以 `dsh plugin add` 安装 |
| 项目文件夹 | 会话工作目录下以论文名命名的子文件夹，PDF 复制入内，一切产物在其中 |
| jc.md | 项目状态文件：frontmatter（stage 缓存、requirements、**confirmations 确认记录**）+ 自由备注 |
| Figure / Panel / 图组 | Figure=原文整图（含图注）；Panel=可独立理解的子图；图组=多 Panel 拼合的组合图（groups.json 登记） |
| 确认点 | 三个用户暂停点：图源核对、outline.md、deck 渲染前；确认记录在 jc.md，内容变更即失效 |
| figures.json | 图源契约：documents / figures / regions / panels（bbox 用 PDF pt）；写入只经 update_figures |
| update_figures | figures.json 唯一写入通道：json-patch + base-rev 乐观锁 + 滚动快照 |
| whole-Panel | 无 Panel 单图的归一化表示（label 为空、bbox=整图） |
| MinerU / mineru-open-api | PDF 解析服务及其官方 CLI；高精度模式需 token，flash 免费受限 |
| content-list | MinerU 结构化输出（每块带 type/page/bbox），整图定位与 evidence 底料 |
| deck.md | 幻灯片内容契约：frontmatter + `---` 分页 + 页头注释 + 讲稿引用块；PPTX 的唯一内容源 |
| PPTD | dsh 生态 PPT 中间契约（YAML 工程，dsh-ppt-maker 使用）；deck.md 的派生物，单向不回写 |
| 主线 / 补充 | 讲述内容的两个层级（继承 SmartJC），补充默认位于主线后并明确标识 |
| agent 视觉切分 | Panel 切分方式：agent 看高清页图给粗框，crop 裁出验证、迭代修正 |
