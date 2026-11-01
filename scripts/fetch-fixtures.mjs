import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../tests/fixtures/papers/', import.meta.url)
const fixtures = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
await mkdir(root, { recursive: true })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

for (const fixture of fixtures) {
  const target = new URL(fixture.file, root)
  try {
    if (digest(await readFile(target)) !== fixture.sha256) {
      throw new Error(`Fixture hash mismatch: ${fixture.file}; preserve and inspect the local file before replacing it`)
    }
    console.log(`Verified ${fixture.file}`)
    continue
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const response = await fetch(fixture.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${fixture.file}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (digest(bytes) !== fixture.sha256) throw new Error(`Downloaded fixture hash mismatch: ${fixture.file}`)
  const temporary = `${fileURLToPath(target)}.${process.pid}.tmp`
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  console.log(`Downloaded and verified ${fixture.file}`)
}
