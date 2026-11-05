# Journal Club · DeepSeek Harness 文献汇报插件

[![CI](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml)[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)[![Node.js >=22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white)](package.json)

从生物医学论文出发，核对原图、自由拼图，生成带讲稿的学术汇报。

A DeepSeek Harness plugin that turns biomedical papers into figure-grounded journal club presentations with editable compositions and speaker notes.

![论文解析、图源核对、自由拼图、汇报与讲稿](docs/assets/journal-club-banner.zh-CN.png)

## 安装

在 DSH 侧栏打开 **插件 → 添加插件**，输入 `dsh-journal-club@0.0.1`，安装后点击 **立即启用**。也可以在对话中说：“帮我安装 DSH 插件 `dsh-journal-club@0.0.1`”。

论文解析使用官方 MinerU API，配置 `MINERU_TOKEN`，或复用已有 `~/.mineru/config.yaml` 中的 token；无需全局 MinerU CLI 或 Python PDF 引擎。论文会上传 MinerU。导出 PPTX 需另装 [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker)。

## 使用

1. 在 DSH 打开自己的论文工作目录，附上主论文和可选的补充 PDF。
2. 提出要求，例如：“用 journal-club 做一份 15 分钟中文文献汇报，保留全部主图，附讲稿。”
3. 在右侧 **Journal Club** 工作台检查图源、调整裁切和拼图，依次确认**图源、大纲、文稿**，再导出 PPTX。

裁切更新后，到自由拼图中点击“刷新图源”，保留原排版并更新图片。导出后在 PowerPoint 中做最终检查。

完整流程适用于生物医学原创研究，也可单独切图、拼图或校验。产物以 Markdown、JSON、图片和 PPTX 保存在论文目录中，可继续编辑。

## 文档

- [产品设计](docs/product/产品设计.md)：使用流程、确认点与工作台交互。
- [架构设计](docs/architecture/架构设计.md)：工具与文件契约、API、开发和发布。
- [数据与安全](SECURITY.md)：论文上传、模型处理和敏感信息边界。

## 许可与致谢

软件和原创文档采用 [MIT 协议](LICENSE)，第三方论文与图像保留原许可。感谢 DeepSeek Harness、[MinerU](https://github.com/opendatalab/MinerU)、dsh-ppt-maker。
