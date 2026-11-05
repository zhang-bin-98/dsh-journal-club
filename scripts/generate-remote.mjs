import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { WorkspaceAnalyzer, FaceModelEmitter, writePackageArtifacts } from '@deepseek-ai/dsh-typert-generator'

// The official analyzer requires a packages/ workspace and ownership of Remote
// metadata and recursive JSON types. Stage the installed declarations unchanged;
// only staging export paths differ from their build-output locations.
const cache = resolve('node_modules/.cache')
const root = resolve(cache, 'journal-club-typert')
if (!root.startsWith(`${cache}${sep}`)) throw new Error('Invalid Typert staging directory')
await rm(root, { recursive: true, force: true })
const pkg = resolve(root, 'packages/journal-club')
await mkdir(pkg, { recursive: true })
await cp('src', resolve(pkg, 'src'), { recursive: true })
await cp('package.json', resolve(pkg, 'package.json'))
const config = JSON.parse(await readFile('tsconfig.json', 'utf8'))
config.include = ['src/index.ts', 'src/project.ts', 'src/globals.d.ts']
const references = [{ path: './packages/journal-club' }]
config.compilerOptions.paths = {}
for (const name of ['dsh-typert-protocol', 'dsh-session', 'dsh-util-values']) {
  const staged = resolve(root, 'packages', name)
  const installed = resolve('node_modules/@deepseek-ai', name)
  await mkdir(staged, { recursive: true })
  await cp(resolve(installed, 'lib/types'), resolve(staged, 'types'), { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'))
  manifest.exports = Object.fromEntries(Object.entries(manifest.exports)
    .filter(([, value]) => typeof value === 'object' && value.types?.startsWith('./lib/types/'))
    .map(([key, value]) => [key, { types: value.types.replace('./lib/types/', './types/') }]))
  await writeFile(resolve(staged, 'package.json'), JSON.stringify(manifest))
  await writeFile(resolve(staged, 'tsconfig.json'), JSON.stringify({ ...config, include: ['types'] }))
  for (const [key, value] of Object.entries(manifest.exports)) {
    config.compilerOptions.paths[`@deepseek-ai/${name}${key === '.' ? '' : key.slice(1)}`] = [resolve(staged, value.types)]
  }
  references.push({ path: `./packages/${name}` })
}
await writeFile(resolve(pkg, 'tsconfig.json'), JSON.stringify(config))
await writeFile(resolve(root, 'tsconfig.host.json'), JSON.stringify({ compilerOptions: config.compilerOptions, files: [], references }))
// Analyze this plugin only, while registering its real dependency declarations.
// The higher-level workspace generator analyzes every discovered host service.
const workspace = new WorkspaceAnalyzer({ root, packages: ['dsh-journal-club'], faces: ['host'] }).analyze()
const artifacts = workspace.faces.map(face => new FaceModelEmitter(face).emit('dsh-journal-club'))
if (!artifacts.some(artifact => artifact.remote)) throw new Error('journal-club: no Remote artifacts generated')
writePackageArtifacts(resolve('.'), artifacts)
