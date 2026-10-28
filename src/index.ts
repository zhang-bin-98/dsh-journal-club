import type { Context } from '@deepseek-ai/cordis'
import { registerCrop } from './tools/crop.ts'
import { registerRenderPages } from './tools/renderPages.ts'

/**
 * dsh-journal-club host 入口（架构 §2）。
 * M1：render_pages + crop。后续里程碑在同一注册点追加
 * compose_panels（M5）、update_figures / validate（M2）。
 */
export const name = 'dsh-journal-club'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerRenderPages(ctx)
  registerCrop(ctx)
}
