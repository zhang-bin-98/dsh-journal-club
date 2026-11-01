import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this script with npm run verify:pack')
const destination = resolve('out/release')
await mkdir(destination, { recursive: true })
const [packed] = JSON.parse(execFileSync(process.execPath,
  [npmCli, 'pack', '--json', '--pack-destination', destination], { encoding: 'utf8' }))
const files = new Set(packed.files.map(file => file.path))
const required = ['package.json', 'LICENSE', 'README.md', 'README.zh-CN.md', 'SECURITY.md',
  'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/project.js',
  'lib/typert.host.js', 'lib/typert.remote-client.js',
  'src/skills/journal-club/SKILL.md', 'src/skills/journal-club/references/narrative.md',
  'src/skills/journal-club/references/formats.md']
for (const file of required) {
  if (!files.has(file)) throw new Error(`Package missing ${file}`)
}
for (const file of files) {
  if (/^(?:out|tests|docs\/verification|node_modules)\//.test(file) || /(?:^|\/)\.env(?:\.|$)/.test(file)) {
    throw new Error(`Unexpected package file ${file}`)
  }
}
const archive = resolve(destination, packed.filename)
const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(`${archive}.sha256`, `${hash}  ${packed.filename}\n`)
console.log(`Verified ${packed.filename}: ${files.size} files; SHA-256 written`)
