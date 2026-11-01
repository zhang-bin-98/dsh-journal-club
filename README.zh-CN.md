# Journal Club · DeepSeek Harness 文献汇报插件

[![CI](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white)](package.json)
[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek_Harness-Plugin-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | [简体中文](README.zh-CN.md)

![Journal Club：论文解析、图源核对、自由拼图、汇报与讲稿](docs/assets/journal-club-banner.zh-CN.png)

从生物医学论文出发，核对原图、自由拼图，生成带讲稿的学术汇报。

本插件运行在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中。你在对话里提出要求，在右侧工作台检查和调整图片，产物保存在自己的论文目录中，都是普通 Markdown、JSON 和图片文件。

## 能做什么

- **准备文献汇报**：从原创研究 PDF 生成有证据对应的论文分析、叙事大纲、幻灯片文稿与讲稿。
- **核对与裁切原图**：查看原页、手动调整 Panel 边界，检查跨页图注与图源对应。
- **自由拼图**：拖动、缩放、按图片外缘导出；建议排版参考论文原布局，图片数量和比例不设固定限制。
- **保留完整证据**：默认展示正文全部主图及标号 Panel，用讲稿详略控制时间；支持人工核对和明确的用户排除。
- **单独使用工具**：只切图、拼图或校验时，无需创建完整汇报项目。
- **导出 PPTX**：通过另行安装的 [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker) 完成。

## 安装

> 首个 npm 版本 `0.0.1` 待发布；发布后可通过以下方式安装。

**桌面端安装（推荐）**：打开 DSH 侧栏的 **插件** → **添加插件**，输入 `dsh-journal-club@0.0.1`。安装完成后点击 **立即启用**。

**对话中安装**：告诉模型：“帮我安装 DSH 插件 `dsh-journal-club@0.0.1`”。

请带上版本号，避免只写包名时安装到较旧的版本。卸载可在插件页面点击 **移除**，已有论文项目文件会保留。

完整论文流程需配置 [MinerU CLI](https://github.com/opendatalab/MinerU-Ecosystem)；PPTX 导出还需 [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker)。命令行安装与开发说明见 [架构文档](docs/architecture/架构设计.md#安装说明)，数据处理范围见 [数据边界](SECURITY.md)。

## 第一次使用

1. 在 DSH 打开独立论文工作目录，附上 PDF。无需在插件源码目录内操作。
2. 在对话里提出：**“用 journal-club 做一份 15 分钟中文文献汇报，保留全部主图，附讲稿。”**
3. 打开右侧 **Journal Club** 工作台，检查图源，按需手动裁切，再通过对话或流程卡片确认图源。
4. 继续核对大纲与幻灯片文稿。自由拼图中可拖动调整；选中拼图后点“加入对话”，再让 AI 修改。
5. 若发现原图裁切有误，返回图源核对调整；再到拼图中“刷新图源”，会保留排版并保存更新后的图片。导出后在 PowerPoint 中进行最终检查。

完整流程适用于生物医学原创研究。综述等其他论文类型不进入完整科学内容生成流程，但仍可单独切图或拼图。

## 文件即真相

| 文件 | 内容 |
|---|---|
| `jc.md` | 流程备注与确认记录 |
| `analysis.md`、`outline.md` | 论文分析与叙事大纲 |
| `figures.json` | 图源、Panel 身份、图注与裁切坐标 |
| `groups.json` | 拼图身份、成员与布局 |
| `slides.md` | 幻灯片内容与讲稿 |
| PNG / PPTX | 派生图片与演示文稿 |

工作台读取这些文件。修改裁切或已有拼图时保留身份；图片和 PPTX 是派生产物。人工检查、调整与整图兜底属于正常使用流程。

## 开发与文档

核心文档保留两份：[产品设计](docs/product/产品设计.md) 说明使用流程与工作台交互；[架构设计](docs/architecture/架构设计.md) 说明文件契约、开发验证与发布流程。

问题反馈请到 [Issues](https://github.com/zhang-bin-98/dsh-journal-club/issues)，优先提供不含私人论文和密钥的最小复现。

## 许可与致谢

项目软件和原创文档采用 [MIT 协议](LICENSE)。第三方论文和图像仍遵循各自许可；真实测试论文单独下载，不随插件分发。

感谢 DeepSeek Harness、[MinerU](https://github.com/opendatalab/MinerU) 与 dsh-ppt-maker。SmartJC 提供了原始产品流程、科研叙事规则和布局实现；适配范围见 [架构复用清单](docs/architecture/架构设计.md)。
