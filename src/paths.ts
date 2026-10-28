import { basename, isAbsolute, resolve } from 'node:path'

/**
 * 工具入参的相对路径基于会话工作目录解析（dsh host 进程即运行于该目录），
 * 绝对路径原样返回。
 */
export function resolveWorkspacePath(input: string): string {
  return isAbsolute(input) ? input : resolve(process.cwd(), input)
}

/** 文件名主干清理：去掉扩展名，替换文件系统不安全字符，保底防空串。 */
export function sanitizeStem(input: string, fallback: string): string {
  const stem = basename(input).replace(/\.[^.]+$/u, '').replace(/[^\w.-]+/gu, '_')
  return stem === '' ? fallback : stem
}

/** 输出 PNG 的页码后缀，固定三位零填充（论文页数 < 1000）。 */
export function pageSuffix(page: number): string {
  return String(page).padStart(3, '0')
}
