import { readFile } from 'node:fs/promises'
import { parseFiguresJson, type FiguresJson } from './schema.ts'
export * from './schema.ts'

/** 读取并校验 figures.json 的基础结构；跨字段写入校验由 update_figures 执行。 */
export async function loadFiguresJson(absPath: string): Promise<FiguresJson> {
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch (error) {
    throw new Error(`figures.json 不可读（${absPath}）：${(error as Error).message}`)
  }
  return parseFiguresJson(raw, absPath)
}
