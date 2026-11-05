import { createHash } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'

const [archive, sourcePath = 'package.json', registry = 'https://registry.npmjs.org'] = process.argv.slice(2)
if (!archive) throw new Error('Expected the verified release archive')
const source = JSON.parse(await readFile(sourcePath, 'utf8'))
const response = await fetch(`${registry}/${encodeURIComponent(source.name)}/${encodeURIComponent(source.version)}`, { signal: AbortSignal.timeout(30_000) })
let published = false
if (response.ok) {
  const remote = await response.json()
  const integrity = `sha512-${createHash('sha512').update(await readFile(archive)).digest('base64')}`
  if (remote.name !== source.name || remote.version !== source.version || !remote.dist?.integrity?.split(/\s+/).includes(integrity)) {
    throw new Error('Published npm version differs from this archive; refusing to overwrite or skip it')
  }
  published = true
} else if (response.status !== 404) {
  throw new Error(`Could not check npm publication: HTTP ${response.status}`)
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${published}\n`)
console.log(published ? 'The identical npm package is already published.' : 'npm version is not published yet.')
