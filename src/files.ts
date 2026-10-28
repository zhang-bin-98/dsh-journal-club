import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 完整写入临时文件后原子替换目标文件；失败时清理临时文件并保留旧目标。 */
export async function atomicWriteFile(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${path.split(/[\\/]/u).pop() ?? 'file'}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  try {
    await writeFile(temp, data)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
