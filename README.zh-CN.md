# Journal Club · DeepSeek Harness 文献汇报插件

[English](README.md) | [简体中文](README.zh-CN.md)

从生物医学论文出发，核对原图、自由拼图，生成带讲稿的学术汇报。

本插件运行在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中。你在对话里提出要求，在右侧工作台检查和调整图片，产物保存在自己的论文目录中，都是普通 Markdown、JSON 和图片文件。

## 工作台预览

![自由拼图工作台](docs/assets/free-composition.png)

使用合成图片的浏览器示例截图，展示拼图编辑区，不包含论文内容。

## 能做什么

- **准备文献汇报**：从原创研究 PDF 生成有证据对应的论文分析、叙事大纲、幻灯片文稿与讲稿。
- **核对与裁切原图**：查看原页、手动调整 Panel 边界，检查跨页图注与图源对应。
- **自由拼图**：拖动、缩放、按图片外缘导出；建议排版参考论文原布局，图片数量和比例不设固定限制。
- **保留完整证据**：默认展示正文全部主图及标号 Panel，用讲稿详略控制时间；支持人工核对和明确的用户排除。
- **单独使用工具**：只切图、拼图或校验时，无需创建完整汇报项目。
- **导出 PPTX**：通过另行安装的 [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker) 完成。

## 安装

需要 Node.js **≥22.13**（推荐 Node 24 LTS）、npm 和兼容的 DeepSeek Harness。包声明面向 DSH `>=0.2.0-0`；宿主 API 仍处于预发布阶段，不代表所有后续版本均已实测。

```sh
git clone https://github.com/zhang-bin-98/dsh-journal-club.git
cd dsh-journal-club
npm ci
npm run build
dsh plugin add .
```

安装到日常使用的 DSH profile。安装或更新后完整重启宿主，让前后端接口同时生效。

完整论文流程还需要官方 [MinerU CLI](https://github.com/opendatalab/MinerU-Ecosystem)：`npm install -g mineru-open-api`，再通过其 `auth` 命令配置认证。高精度解析会将论文上传至 MinerU；模型处理使用宿主配置的服务商，详见 [数据边界](SECURITY.md)。

PPTX 导出需要在同一宿主安装 dsh-ppt-maker。未安装时，仍可使用文稿、裁图和拼图产物。本项目**尚未发布到 npm**；已配置 GitHub Release 打包，首个版本发布前请使用上述源码安装方式，不要直接按 npm 包名安装。

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

[开发与发布](docs/development.md) 说明本地回归、样本下载以及 `main` / 本地 `develop` 工作模式。[文档索引](docs/README.md) 包含产品设计、图源核对、自由拼图、文件契约与架构。

问题反馈请到 [Issues](https://github.com/zhang-bin-98/dsh-journal-club/issues)，优先提供不含私人论文和密钥的最小复现。

## 许可与致谢

项目软件和原创文档采用 [MIT 协议](LICENSE)。第三方论文和图像仍遵循各自许可；真实测试论文单独下载，不随插件分发。

感谢 DeepSeek Harness、[MinerU](https://github.com/opendatalab/MinerU) 与 dsh-ppt-maker。SmartJC 提供了原始产品流程、科研叙事规则和布局实现；适配范围见 [架构复用清单](docs/architecture/架构设计.md)。
