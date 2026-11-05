import { createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 内容摘要（小写十六进制）；各处 sha256 都用这一份。 */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 取消信号已触发时抛出；与工具、写入服务的取消语义一致。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('操作已取消')
}

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
