import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'

const source = JSON.parse(await readFile('package.json', 'utf8'))
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME
  : process.env.REQUESTED_TAG || `v${source.version}`
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error('Invalid release tag')
const refs = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim()
if (!refs) {
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE === 'tag') throw new Error('Release tag does not exist')
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'ready=false\n')
  console.log(`No ${tag} tag yet; skipping release.`)
} else {
  const commit = execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim()
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'])
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=true\ntag=${tag}\ncommit=${commit}\n`)
  console.log(`Release ${tag} from ${commit}`)
}
