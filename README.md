# Journal Club for DeepSeek Harness

[![CI](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zhang-bin-98/dsh-journal-club/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white)](package.json)
[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek_Harness-Plugin-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | [简体中文](README.zh-CN.md)

![Journal Club: paper, figure review, free composition, slides and speaker notes](docs/assets/journal-club-banner.en.png)

Turn a biomedical research paper into a figure-grounded journal club presentation, with editable crops, free-form compositions and speaker notes.

Journal Club is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Ask the agent to work in your own paper folder, review figures in the workbench, and keep the results as ordinary Markdown, JSON and image files.

## What you can do

- Prepare an academic presentation from an original biomedical research PDF, with an evidence-linked analysis, outline and slide manuscript.
- Inspect figure sources, adjust panel crops and recover captions across pages.
- Arrange panels freely: drag, resize, refresh sources while preserving layout, and export tightly around the images. Original figure arrangements guide suggested layouts.
- Include all main-text figures and labeled panels by default; control talk duration through speaker-note detail, with human review and explicit exclusions.
- Use cropping, composition and validation independently, without starting a complete paper project.
- Export PPTX through the separately installed [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker) plugin.

## Install

> The first npm release, `0.0.1`, is pending. After publication, use either option below.

**Desktop (recommended):** go to **Plugins** → **Add plugin** in the DSH sidebar and enter `dsh-journal-club@0.0.1`. Once installed, select **Enable now**.

**In chat:** ask: “Please install the DSH plugin `dsh-journal-club@0.0.1`.”

Include the version number to avoid receiving an older version when installing by name alone. To uninstall, use **Remove** on the plugin page; existing paper project files are preserved.

The full workflow requires the [MinerU CLI](https://github.com/opendatalab/MinerU-Ecosystem), and PPTX export also needs [dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker). For CLI installation and development, see [setup details](docs/architecture/架构设计.md#安装说明); see [data boundaries](SECURITY.md) for data handling.

## Your first journal club

1. Open a separate paper workspace in DSH and attach the paper PDF. You do not need to work inside this plugin's source folder.
2. Ask: “Use journal-club to prepare a 15-minute biomedical journal club in Chinese, with all main figures and speaker notes.”
3. Open **Journal Club** in the right workbench. Review the sources and adjust crops, then confirm the figures in chat or through the workflow card.
4. Review the outline and slide manuscript at the next two confirmation points. Use **Free composition** to adjust figure groups; **Add to conversation** gives the agent a reference to the selected composition.
5. After a source crop changes, return to the composition and refresh sources. The current arrangement is preserved and saved with refreshed images. Review the final PPTX in PowerPoint before presenting.

The full workflow targets original biomedical research. Reviews and other paper types can still be used for a scoped figure task, but are not supported by the complete scientific-content workflow.

## Files stay yours

| File | Purpose |
|---|---|
| `jc.md` | Workflow notes and confirmation records |
| `analysis.md`, `outline.md` | Evidence analysis and narrative outline |
| `figures.json` | Figure sources, panel identities, captions and crop coordinates |
| `groups.json` | Composition identities, members and saved geometry |
| `slides.md` | Slide content and speaker notes |
| PNG / PPTX | Derived visual outputs |

The workbench reads these files. Editing a crop or composition keeps its identity; generated images and presentations are derived artifacts. Human inspection and adjustment are part of the workflow.

## Development and documentation

The two core documents are currently in Chinese: [product design](docs/product/产品设计.md) covers workflows and workbench interactions; [architecture](docs/architecture/架构设计.md) covers file contracts, local development, validation and release.

Report reproducible problems in [Issues](https://github.com/zhang-bin-98/dsh-journal-club/issues), using synthetic examples without private papers or credentials.

## License and acknowledgements

[MIT](LICENSE) for the project's software and original documentation. Third-party papers and figures retain their own licenses; real test papers are downloaded separately and are not bundled with the plugin.

Built on DeepSeek Harness, [MinerU](https://github.com/opendatalab/MinerU), and the dsh-ppt-maker ecosystem. SmartJC supplied the original workflow, scientific narration rules and reusable layout logic; the adaptation inventory is recorded in the [architecture](docs/architecture/架构设计.md).
