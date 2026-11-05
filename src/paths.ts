import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 从 dsh 工具执行上下文取得会话工作目录；单测/离线调用回退进程目录。 */
export interface WorkspaceExecution {
  readonly agent?: {
    readonly session?: {
      readonly header?: {
        readonly cwd?: string
      }
    }
  }
}

export function workspaceCwd(exec?: WorkspaceExecution): string {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && isAbsolute(cwd) ? cwd : process.cwd()
}

/** 工具入参相对路径基于会话工作目录解析，绝对路径原样返回。 */
export function resolveWorkspacePath(input: string, cwd = process.cwd()): string {
  return isAbsolute(input) ? input : resolve(cwd, input)
}

/** 给清洗后的文件名追加稳定短标识，避免不同源文件名称碰撞。 */
function stableStem(input: string, fallback: string): string {
  const raw = basename(input).replace(/\.[^.]+$/u, '')
  const stem = raw.replace(/[^\w.-]+/gu, '_') || fallback
  if (raw === stem) return stem
  let hash = 2166136261
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${stem}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** 输出 PNG 的页码后缀，固定三位零填充（论文页数 < 1000）。 */
function pageSuffix(page: number): string {
  return String(page).padStart(3, '0')
}

/** 以会话 cwd 为基准显示路径，统一使用 POSIX 分隔符。 */
export function displayWorkspacePath(absPath: string, cwd = process.cwd()): string {
  const rel = relative(cwd, absPath)
  return rel === '' || rel.startsWith('..') ? absPath.split(sep).join('/') : rel.split(sep).join('/')
}

/** 只允许作为单一文件名片段的稳定 ID，拒绝路径穿越及 Windows 保留形式。 */
export function assertSafeAssetId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) || id === '.' || id === '..') {
    throw new Error(`非法 panel id：${id}（只能包含字母、数字、点、下划线和短横线）`)
  }
  const stem = id.split('.')[0]?.toUpperCase() ?? id.toUpperCase()
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem)) {
    throw new Error(`非法 panel id：${id}（Windows 保留名称）`)
  }
}

/** 目标是否位于目录内（按词法路径，不跟随链接）。 */
export function isInsideDirectory(target: string, directory: string): boolean {
  const rel = relative(resolve(directory), resolve(target))
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** 确认目标位于目录内，避免 ID 或路径逃逸。 */
export function assertInsideDirectory(target: string, directory: string): void {
  if (!isInsideDirectory(target, directory)) throw new Error(`路径超出目标目录：${target}`)
}

/** 解析会话工作区内的真实文件：先查词法范围，再 realpath 查符号链接目标。 */
export async function projectFile(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd)
  const target = resolve(root, path)
  assertInsideDirectory(target, root)
  const canonical = await realpath(target)
  assertInsideDirectory(canonical, root)
  return canonical
}

/** render_pages 页图位置：PDF 同目录 `pages/<文档名>-<NNN>.png`；工作台按同一约定找底图。 */
export function pageImagePath(pdfPath: string, page: number): string {
  return join(dirname(pdfPath), 'pages', `${stableStem(pdfPath, 'doc')}-${pageSuffix(page)}.png`)
}
