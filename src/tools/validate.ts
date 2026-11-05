import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveWorkspacePath, workspaceCwd, displayWorkspacePath } from '../paths.ts'
import { validateProject, type ValidationIssue } from '../validate/project.ts'

function renderIssues(title: string, issues: ValidationIssue[]): string[] {
  if (issues.length === 0) return []
  return [`${title}:`, ...issues.map(item => {
    const location = [item.path, item.page === undefined ? undefined : `page ${item.page}`, item.panel, item.group]
      .filter(Boolean)
      .join(' · ')
    return `  ${item.code}: ${item.message}${location === '' ? '' : `（${location}）`}`
  })]
}

export function registerValidate(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'validate',
      description: '校验项目目录中的 figures.json、groups.json、slides.md、outline.md 一致性，返回可判定 errors 与 warnings。',
      parameters: {
        project_dir: {
          type: 'string',
          required: true,
          description: '论文项目目录（相对会话工作目录或绝对路径）',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            project_dir: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  path: { type: 'string' },
                  page: { type: 'integer' },
                  panel: { type: 'string' },
                  group: { type: 'string' },
                },
              },
            },
            warnings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  path: { type: 'string' },
                  page: { type: 'integer' },
                  panel: { type: 'string' },
                  group: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `validate：${value.project_dir}`,
              `errors=${(value.errors ?? []).length}, warnings=${(value.warnings ?? []).length}`,
              ...renderIssues('errors', (value.errors ?? []) as unknown as ValidationIssue[]),
              ...renderIssues('warnings', (value.warnings ?? []) as unknown as ValidationIssue[]),
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        const cwd = workspaceCwd(exec)
        const absProject = resolveWorkspacePath(args.project_dir, cwd)
        const report = await validateProject(absProject)
        return {
          project_dir: displayWorkspacePath(absProject, cwd),
          errors: report.errors,
          warnings: report.warnings,
        }
      },
    }),
  )
}
