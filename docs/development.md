# 开发与发布

## 本地开发

使用 Node.js 24 LTS 和 npm；包声明的最低 Node 版本为 22.13。宿主依赖仍处于预发布阶段，实际兼容范围以验证结果为准。

```sh
npm ci
npm run fixtures:fetch
npm run typecheck
npm test
npm run verify:pack
```

`npm test` 的前置步骤会构建 host/client 与官方 Typert Remote 产物，无需重复构建。首次下载固定论文样本需要网络，已有文件通过 SHA-256 校验后直接复用；普通回归不调用 MinerU 或模型。样本来源见 [fixture 说明](../tests/fixtures/papers/README.md)。

`npm run verify:pack` 重新构建并检查安装包的入口、skill 和许可证，产物保存在忽略目录 `out/release/`。调试记录与真实论文验收产物分别放在 `out/` 和本地 `docs/verification/`，不加入 Git。

## 分支

- `main`：唯一推送到 `origin` 的长期分支，也是 GitHub 默认分支。
- `develop`：本地日常开发，不配置远端跟踪，不推送。
- 专项工作可以从 `develop` 创建临时 `codex/<topic>` 分支，完成后以 `--no-ff` 合回 `develop` 并删除临时分支。
- 验收后用 `git merge --no-ff develop` 合入 `main`，保留合并拓扑。不得用 squash 或 rebase 替代发布合并。

```sh
git switch main
git merge --no-ff develop
git push origin main
git switch develop
```

仅显式推送 `main`；不要使用 `git push --all` 或 `--mirror`。外部贡献者可通过 fork 向 `main` 提交 PR。

## GitHub 检查与发布

CI 在 `main` push、面向 `main` 的 PR 和手动触发时运行：安装锁定依赖、下载并校验 fixture、类型检查、固定回归和安装包检查。Windows 与 Linux 都运行，CI 不需要模型或 MinerU 密钥。

发布流程独立于 CI：维护者确认 `main` 通过检查后，更新 `package.json` 和锁文件的版本，通过相同合并流程进入 `main`，再显式推送匹配版本的 `vX.Y.Z` 标签。工作流验证标签位于 `main` 历史、版本一致，完成检查后生成带 SHA-256 文件的 GitHub **草稿 Release**；维护者检查安装后再发布。普通代码推送不会创建 Release。

当前不配置 npm 发布或 `NPM_TOKEN`。GitHub Release 使用 Actions 自带的 `GITHUB_TOKEN`。尚未发布的安装包不能在用户文档中描述成已发布版本。

公开仓库设置：简介使用包描述；Topics 为 `dsh-plugin`、`deepseek-harness`、`journal-club`、`biomedical-research`、`scientific-presentations`；保留 merge commit 合并方式，关闭 squash/rebase 合并选项。

## 文档维护

英文 [README](../README.md) 与 [中文 README](../README.zh-CN.md) 面向使用者，安装步骤保持一致。产品与架构契约仍在 [文档索引](README.md) 所列权威位置维护，不复制另一套设计。不要在首页堆积阶段验收数字，也不要把未验证的平台或安装途径写成已支持。
