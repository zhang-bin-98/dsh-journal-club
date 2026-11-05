import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { atomicWriteFile } from '../files.ts'
import { PdfFile } from '../pdf/pdf.ts'
import { pageImagePath, resolveWorkspacePath, workspaceCwd, displayWorkspacePath } from '../paths.ts'

/**
 * render_pages：PDF 页 → PNG 底图（架构 §3）。
 * 产物写 PDF 同目录 pages/<文档名>-<NNN>.png；150 DPI 浏览底图 / 300 DPI 识别。
 */

export function registerRenderPages(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'render_pages',
      description:
        '渲染 PDF 指定页为 PNG 底图，写入 PDF 同目录的 pages/<文档名>-<页号>.png。' +
        '150 DPI 用于整页浏览与核对底图，300 DPI 用于图源/标签精细识别。支持旋转页（按旋转后视觉朝向输出）。' +
        '返回 PDF 总页数 num_pages 和各页 PNG 的路径、宽高；可只渲染第 1 页供读图识别论文标题与类型。',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'PDF 文件路径（相对会话工作目录或绝对路径）',
        },
        pages: {
          type: 'array',
          required: true,
          items: { type: 'integer', description: '1 起始页码' },
          description: '要渲染的页码列表（1 起始）',
        },
        dpi: {
          type: 'integer',
          enum: [150, 300],
          description: '渲染 DPI，默认 150',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pdf: { type: 'string', description: '解析后的 PDF 路径' },
            num_pages: { type: 'integer' },
            dpi: { type: 'integer' },
            output_dir: { type: 'string', description: 'PNG 输出目录' },
            rendered: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  page: { type: 'integer' },
                  path: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `render_pages：${value.pdf}（共 ${value.num_pages ?? '?'} 页）@ ${value.dpi} DPI`,
              ...(value.rendered ?? []).map(r =>
                `  page ${r.page} → ${r.path}（${r.width}×${r.height}px）`,
              ),
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        const cwd = workspaceCwd(exec)
        const dpi = args.dpi ?? 150
        const abs = resolveWorkspacePath(args.path, cwd)
        if (args.pages.length === 0) throw new Error('pages 不能为空')
        const file = await PdfFile.open(abs, exec.signal)
        const invalid = [...new Set(args.pages)].filter(p => p < 1 || p > file.numPages)
        if (invalid.length > 0) {
          throw new Error(`页码越界：${invalid.join(', ')}（共 ${file.numPages} 页）`)
        }
        const rendered: Array<{ page: number; path: string; width: number; height: number }> = []
        for (const page of [...new Set(args.pages)].sort((a, b) => a - b)) {
          const png = await file.renderPage(page, dpi, exec.signal)
          const outPath = pageImagePath(abs, page)
          await atomicWriteFile(outPath, png.data)
          rendered.push({ page, path: displayWorkspacePath(outPath, cwd), width: png.width, height: png.height })
        }
        return {
          pdf: displayWorkspacePath(abs, cwd),
          num_pages: file.numPages,
          dpi,
          output_dir: displayWorkspacePath(dirname(pageImagePath(abs, 1)), cwd),
          rendered,
        }
      },
    }),
  )
}
