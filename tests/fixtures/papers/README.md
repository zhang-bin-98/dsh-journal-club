# 论文 fixture

真实论文 PDF 仅用于本地固定回归，不随 Git 或插件分发，也不适用本项目 MIT 许可。运行 `npm run fixtures:fetch` 从 arXiv 下载指定版本并核对 [manifest](manifest.json) 中的 SHA-256；已有文件匹配则直接复用，不匹配会报错而不会覆盖。

| 文件 | 论文与作者 | 原文许可 |
|---|---|---|
| `2510.07653.pdf` | Jiawen Chen et al., [Large-scale spatial variable gene atlas for spatial transcriptomics, v4](https://arxiv.org/abs/2510.07653v4) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `2601.17669.pdf` | Lei Du, Chenghang Li, Jinzhi Lei, [Quantitative cancer-immunity cycle modeling to optimize bevacizumab and atezolizumab combination therapy for advanced renal cell carcinoma, v1](https://arxiv.org/abs/2601.17669v1) | [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) |
| `2605.13902.pdf` | Jaida C. Lue et al., [A senescent-immune reserve niche hypothesis for incomplete lobular involution in the aging breast, v2](https://arxiv.org/abs/2605.13902v2) | [arXiv 分发许可](https://arxiv.org/licenses/nonexclusive-distrib/1.0/license.html) |

这三篇是渲染与裁切的测试样本，不意味着适用于完整汇报流程：`2605.13902` 为 Review，完整流程应拒绝，局部图源任务可用。下载脚本不修改论文。

`rotated-landscape.pdf` 是本项目生成的合成旋转页资产，随代码按 MIT 发布；生成脚本为 `scripts/make-rotated-fixture.mjs`。

`../parse/mineru-geometry.json` 保留真实 MinerU 输出的块类型、页号与数值坐标，正文和图注均替换为合成占位文本，图片路径也已替换。它只验证解析结构与坐标，不构成论文正文或科研内容质量测试。原始全文解析不公开。
