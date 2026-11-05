# 文件契约与最小示例

示例值仅说明格式，生成时必须换成真实论文的标题、页数、图注、页码和坐标。路径相对论文项目目录；工具参数中的项目目录相对会话工作目录。

## jc.md

```markdown
---
title: 论文标题
main_paper: main.pdf
stage: analysis
requirements: ""
confirmations:
updated: 2026-10-29
---

# 项目备注
```

stage 仅为缓存：analysis / figure-review / outline / slides / render / done。用户明确确认后才添加记录：

```yaml
confirmations:
  figures: { revision: 3, at: 2026-10-29T14:00:00+08:00 }
  outline: { digest: "sha256:<文件字节的 SHA-256 小写十六进制>", at: 2026-10-29T14:00:00+08:00 }
  slides: { digest: "sha256:<slides 文件摘要>", groups_digest: "sha256:<groups 文件摘要>", at: 2026-10-29T14:00:00+08:00 }
```

以上摘要占位符必须替换为真实 64 位值，不能直接保存。更新时保留 requirements 和自由备注。可通过随插件导出的 `dsh-journal-club/project` 模块调用 createJcFile/readJcFile/updateJcFile/digestFile/summarizeProjectConfirmations；运行位置需能解析已安装的插件模块。不能解析时使用宿主文件工具维护同一格式，摘要使用 Node `createHash('sha256').update(await readFile(path)).digest('hex')` 并加 `sha256:` 前缀，不凭记忆计算。始终读取原始字节，不先转换 CRLF/LF、去 BOM 或修剪空白；Python 应用 `read_bytes()`，不要对 `read_text()` 的换行归一化结果计算确认摘要。

## figures.json

首次创建及后续修改均调用 `update_figures`。文件不存在时使用 `base_rev: 0`，服务从 `{version:1,status:"draft",revision:0,documents:[],figures:[]}` 应用 patch；例如 `add /documents/-` 加入真实文档、`add /figures/-` 加入图，或 `add` 根路径 `""` 写完整初始对象（revision 必须为 0）。至少包含一份 document；成功返回 revision=1，首次创建没有旧版快照。不要先用通用编辑器落盘。后续读取当前 revision，针对变更使用 JSON Patch，服务负责递增 revision。每次调用后以返回文件为准。

边界由 agent 看原页与图注判断，不以空白带、亮度阈值或轮廓扫描脚本代替视觉切分。`figures/<panel_id>.png` 通过 `crop` 从原 PDF 生成/刷新，不用 Pillow 等脚本另裁页图或覆盖正式资产；脚本准备 patch 参数不能绕过写入通道。

```json
{
  "version": 1,
  "status": "draft",
  "revision": 0,
  "documents": [{ "id": "main", "path": "main.pdf", "role": "main", "pages": 1 }],
  "figures": [{
    "id": "fig1",
    "label": "Figure 1",
    "status": "pending",
    "regions": [{ "document": "main", "page": 1, "bbox": [20, 40, 500, 400] }],
    "caption": { "page": 1, "sentences": ["实际图注句子。"] },
    "panels": [{
      "id": "fig1_whole",
      "label": null,
      "region_index": 0,
      "bbox": [20, 40, 500, 400],
      "caption_refs": [0],
      "flags": [],
      "origin": "agent"
    }]
  }]
}
```

document role 为 main/supplement；Figure status 为 pending/viewed/adjusted/excluded；panel origin 为 auto/manual/agent。bbox 是旋转后 PDF 页的 pt 坐标 `[x0,y0,x1,y1]`，必须有面积且 panel 在所属 region 内。region_index、caption_refs 都从 0 开始，page 从 1 开始。MinerU 的 page_idx 从 0 开始，写入时加 1；bbox 两轴各除以 1000 再乘旋转后页宽/高，不能把它直接当 pt。

跨页图注：`caption.page` 记录起始物理页，`sentences` 包含经原 PDF 核实的续页图注，完整页码范围记入 `analysis.md`；不要为图注续页新增图像 region。MinerU 可能将续文归为下一页的 `page_footnote`/普通文本，Markdown 不一定包含，不能只检查 `image_caption`。接回断句后同步更新受影响的 `caption_refs`，共享说明仅关联实际适用的 Panel。

Panel ID 全局唯一、删除后不复用；不以图号重命名现有 ID。whole-panel 的 label=null 且 bbox 等于 region。裁切后由 `crop` 回填 `asset: "figures/fig1_whole.png"`。修改前读取当前文件，保留用户手工或 agent 调整，不让重识别静默覆盖。确认前将采纳图设为 viewed/adjusted，排除图设为 excluded，重裁所需资产后读取最终 revision，再记录确认。

## groups.json

完整流程开始时，若文件不存在，创建以下空清单；不覆盖已有图组。无拼图也对该文件计算确认摘要，之后新建/重拼图组会使确认失效。

正式组合图只由 `compose_panels` 或共用导出核心的工作台保存接口生成，像素与登记信息同步更新。不用图像脚本直接粘贴/缩放后覆盖 `groups/*.png`，也不把核对用的联系图登记为正式汇报图组。此约定不限制派生 PPT/PPTX 的生成或排错脚本。

```json
{"version":1,"groups":[]}
```

需要组合图时调用 `compose_panels`：默认修改现有拼图，output 必须沿用 groups.json 的原 asset 路径，保留原 ID/文件名；只有明确新建或另存时传 create:true，新建不能覆盖已有文件。例如首次新建时 create:true， assets 为项目中已有 panel PNG 路径，output 为 `<项目>/groups/fig1_AB.png`，layout_hint 为 grid/rows/1+2。首次拼图尽量沿用原 Figure 的布局：参考原始页图和 Panel 框，保留左右/上下关系、行列分组、相对大小与阅读顺序；必要时用 geometry 明确排布，不默认改成统一网格。只选部分 Panel 时可收紧空隙，跨 Figure 时尽量保留各图内部关系。用户明确要求与已有手动布局优先，不自动改回原图；确因可读性或叙事需要调整时简要说明。也可传 geometry（width、height、cells；每个 cell 含 member/x/y/width/height）自由定位；width/height 为参考尺寸，不作固定裁切边界，导出尺寸由等比适配后实际图片的外接矩形决定。去掉外围空白，保留内部间隔、相对位置和原图内容；拼图不是整页 PPT。比例与图片数量无固定上限。scale 控制输出倍率，省略为 2，与工作台保存一致。工具登记成员、输入摘要与几何；不要手写伪造这些计算结果。用户可在 JC「自由拼图」页面手调，保存后保留原文件名；重新渲染已有人工布局时，读取并复用 geometry，除非用户要求重新排版。slides 使用 `groups/<id>.png`，引用图组时仍标明所有来源图号和页码。

## parse/manifest.json

```json
{"documents":[{"id":"main","source_sha256":"<PDF 原始字节 SHA-256>","mode":"extract","provider":"mineru-api","parser_version":1,"options_digest":"<实际参数摘要>","batch_id":"<实际任务标识>","uploaded":true,"artifacts":["main/main.md","main/main.json","main/images/example.jpg"],"artifact_sha256":{"main/main.md":"<实际摘要>","main/main.json":"<实际摘要>","main/images/example.jpg":"<实际摘要>"},"status":"done"}]}
```

此示例仅说明结构，manifest 由 runner 维护，不要手写示例占位值。每份 PDF 单独输出到 `parse/main/` 或 `parse/supp/`，正文/清单规范化为 `<id>.md`、`<id>.json`；manifest 位于 parse 根目录。artifacts 是相对 parse 根目录的实际文件路径，每个文件都记录 SHA-256。extract 校验 Markdown、content-list 和图像引用，flash 只有 Markdown；成功前为 partial。缓存还要求源摘要、模式、参数摘要、provider/parser_version 与全部产物摘要匹配。高精度保存 batch_id，flash 保存 task_id；上传中断时 uploaded 可能为 false。旧 CLI 元数据可保留，但不直接当作 API 缓存命中。不得保存 token、签名 URL。

## analysis.md 与 outline.md

analysis.md 保留完整发现底稿，按页增量保存。每项发现包括实验条件、观察、解释边界、原文摘录或转述与来源页码，使用实际 panel ID/图片关联证据；正文无图的发现同样记录。不要为汇报时长筛掉发现。

outline.md 用下列结构承接完整讲述，不在此时固定幻灯片页数；学术结构、主图全覆盖与讲稿控时按 [叙事规则](narrative.md)。末尾保留简短的计划覆盖/节奏表，用章节或证据单元定位，不预写最终页码、不新增 frontmatter 字段：

```markdown
---
title: 论文标题
figures_revision: 3
---

# 主线
## 研究问题与必要设计
完整可讲述的内容，保留条件、对照、观察与局限。

![Figure 1](figures/fig1_whole.png)
> 来源：Figure 1 · p.1

# 补充
补充材料中的扩展证据与详细方法，保留其来源；正文主图不因时长移入本节。没有补充内容时可省略。
```

## slides.md

最小合法的一页示例（生成时 figures_revision 使用当前确认的版本）：

```markdown
---
title: 论文标题
paper: main.pdf
figures_revision: 3
generated: 2026-10-29
---

<!-- page 1 · layout: figure-text -->

## 有证据支持的结论

- 简短的组别、测量和发现

![Figure 1](figures/fig1_whole.png)
> 来源：Figure 1 · p.1

> 🗣 **讲稿**：讲述提示（不口播）：详讲，约 1 分钟，按实际图密度调整。
> 解释 Figure 1 的问题、实验对照、观察结果、含义与局限。
```

新增页面用独立一行 `---` 分隔，页号必须从 1 连续递增。layout 可省略，支持 title/text/figure-full/figure-text/two-figures/panel-grid。每张图后紧跟来源行，不夹空行；讲稿块每页必须有，包括标题页。来源形式为 `> 来源：Figure 3B · p.12`，可加 `· 补充材料`。补充图保留 S 编号，例如 `> 来源：Supplementary Figure S9 · p.27 · 补充材料`，或 `Figure S9`；不为通过校验删图或改成正文图号。正文及讲稿保留疑点 `⚠️`；不把疑点标记当成证据。

运行 `validate` 检查项目并修复 errors；warnings 逐项核对；补充图的取舍说明证据作用，正文主图的缺口只有用户明确取舍才记为例外，不能以时长或页数自行弃图。outline/slides 引用稳定图片路径；重裁或重拼后复核图像、revision 和 digest，不能仅改确认记录让旧内容看起来有效。
