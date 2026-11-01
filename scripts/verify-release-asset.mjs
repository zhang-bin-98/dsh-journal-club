import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const [tag, directory = 'release'] = process.argv.slice(2)
const source = JSON.parse(await readFile('package.json', 'utf8'))
if (source.name !== 'dsh-journal-club' || tag !== `v${source.version}`
  || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error('Release tag and package name/version must match the checked-out source')
}
const filename = `${source.name}-${source.version}.tgz`
const assets = (await readdir(directory)).filter(name => /\.(tgz|sha256)$/.test(name)).sort()
if (JSON.stringify(assets) !== JSON.stringify([filename, `${filename}.sha256`].sort())) {
  throw new Error('Expected exactly one versioned tarball and its SHA-256 file')
}
const archive = join(directory, filename)
const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
const checksum = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/)
if (checksum.length !== 2 || checksum[0] !== actual || checksum[1] !== filename) {
  throw new Error('Release checksum mismatch')
}
const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
if (packed.name !== source.name || packed.version !== source.version || packed.license !== 'MIT'
  || packed.repository?.url !== source.repository?.url) {
  throw new Error('Tarball metadata does not match the checked-out source')
}
const distTag = source.version.includes('-') || process.env.RELEASE_PRERELEASE === 'true' ? 'next' : 'latest'
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `archive=${archive.replaceAll('\\', '/')}\ndist_tag=${distTag}\n`)
}
console.log(`Verified ${filename}; npm dist-tag: ${distTag}`)
