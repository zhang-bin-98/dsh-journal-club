import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this script with npm run verify:pack')
const destination = resolve('out/release')
await mkdir(destination, { recursive: true })
const [packed] = JSON.parse(execFileSync(process.execPath,
  // verify:pack already built the package; prepare output would pollute JSON.
  [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], { encoding: 'utf8' }))
const files = new Set(packed.files.map(file => file.path))
const required = ['package.json', 'LICENSE', 'README.md', 'SECURITY.md',
  'locale/en.json', 'locale/zh.json',
  'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/project.js', 'lib/mineru.js',
  'lib/typert.host.js', 'lib/typert.remote-client.js',
  'src/skills/journal-club/SKILL.md', 'src/skills/journal-club/references/narrative.md',
  'src/skills/journal-club/references/formats.md',
  'docs/assets/journal-club-banner.zh-CN.png']
for (const file of required) {
  if (!files.has(file)) throw new Error(`Package missing ${file}`)
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const targets = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []
for (const target of targets(manifest.exports)) {
  // Locale wildcard targets are checked individually below.
  if (!target.includes('*') && !files.has(target.replace(/^\.\//, ''))) {
    throw new Error(`Package export missing from tarball: ${target}`)
  }
}
if (!files.has(manifest.dsh?.bundle?.patch?.replace(/^\.\//, ''))
  || manifest.dsh?.client?.platform !== 'web' || !manifest.exports?.['./client']) {
  throw new Error('Package must declare a shipped DSH bundle patch and web client export')
}
for (const language of ['en', 'zh']) {
  const path = `locale/${language}.json`
  if (manifest.exports?.['./locale/*.json'] !== './locale/*.json') {
    throw new Error('Plugin display locales must be exported')
  }
  const { meta } = JSON.parse(await readFile(path, 'utf8'))
  if (['title', 'description'].some(field => typeof meta?.[field] !== 'string' || !meta[field].trim())) {
    throw new Error(`Plugin display metadata is invalid: ${path}`)
  }
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
