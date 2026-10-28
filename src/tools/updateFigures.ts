import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { updateFigures, type JsonPatchOperation } from '../figures/figuresStore.ts'
import { resolveWorkspacePath, workspaceCwd, displayWorkspacePath } from '../paths.ts'

/**
 * update_figures：figures.json 唯一写入通道（架构 §3）。
 * 先按 base_rev 做 CAS，再执行 RFC6902 patch、跨字段校验、写前快照和原子替换。
 */

export function registerUpdateFigures(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'update_figures',
      description:
        '以 RFC6902 JSON Patch 更新 figures.json。必须提供读取时的 base_rev；revision 由服务统一递增，' +
        '成功写入前保留 .history 快照并原子替换。base_rev 过期时返回冲突与当前 revision，原文件不变。',
      parameters: {
        figures_json: {
          type: 'string',
          required: true,
          description: 'figures.json 路径（相对会话工作目录或绝对路径）',
        },
        patch: {
          type: 'json',
          required: true,
          description: 'RFC6902 patch 数组，支持 add/remove/replace/move/copy/test',
        },
        base_rev: {
          type: 'integer',
          required: true,
          description: '调用方读取到的 figures.json revision；必须匹配当前 revision',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return [{ type: 'text', text: 'update_figures：完成' }]
          }
          const result = value as { ok?: boolean; conflict?: boolean; revision?: number; figures_json?: string; history_path?: string }
          if (result.conflict) {
            return [{ type: 'text', text: `update_figures：版本冲突，当前 revision=${result.revision ?? '?' }，请重载后重试。` }]
          }
          return [
            {
              type: 'text',
              text: `update_figures：${result.figures_json ?? 'figures.json'} 已写入 revision=${result.revision ?? '?'}${result.history_path === undefined ? '' : `，快照 ${result.history_path}`}`,
            },
          ]
        },
      },
      async execute(args, exec) {
        const absPath = resolveWorkspacePath(args.figures_json, workspaceCwd(exec))
        const result = await updateFigures(
          {
            figures_json: absPath,
            patch: args.patch as unknown as readonly JsonPatchOperation[],
            base_rev: args.base_rev,
          },
          { signal: exec.signal },
        )
        if (result.conflict) {
          return {
            ok: false,
            conflict: true,
            figures_json: displayWorkspacePath(absPath, workspaceCwd(exec)),
            revision: result.revision,
            current: result.current,
          } as unknown as import('@deepseek-ai/dsh-util-values').JsonValue
        }
        return {
          ok: true,
          conflict: false,
          figures_json: displayWorkspacePath(absPath, workspaceCwd(exec)),
          revision: result.revision,
          history_path: displayWorkspacePath(result.historyPath, workspaceCwd(exec)),
          figures: result.figures,
        } as unknown as import('@deepseek-ai/dsh-util-values').JsonValue
      },
    }),
  )
}
