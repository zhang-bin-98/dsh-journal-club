import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'

const exec = promisify(execFile)
const plan = resolve('scripts/plan-release.mjs')
const checkNpm = resolve('scripts/check-npm-release.mjs')
const verifyAsset = resolve('scripts/verify-release-asset.mjs')
const source = { name: 'dsh-journal-club', version: '0.0.1', license: 'MIT', repository: { url: 'git+https://github.com/zhang-bin-98/dsh-journal-club.git' } }
let work: string
const output = () => join(work, 'output.txt')
const env = () => ({ ...process.env, GITHUB_OUTPUT: output(), GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main', REQUESTED_TAG: '', RELEASE_PRERELEASE: 'false' })
const git = (...args: string[]) => exec('git', args, { cwd: work })
const node = (script: string, args: string[] = [], overrides: Record<string, string> = {}) => exec(process.execPath, [script, ...args], { cwd: work, env: { ...env(), ...overrides } })

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'jc-release-'))
  await writeFile(join(work, 'package.json'), JSON.stringify(source))
})
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

async function repository() {
  await git('init', '-b', 'main')
  await git('add', 'package.json')
  await git('-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture')
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD')
}

it('工作流变更遇到尚未创建的标签时跳过，显式发布缺失或非法标签时报错', async () => {
  await git('init', '-b', 'main')
  await node(plan)
  expect(await readFile(output(), 'utf8')).toBe('ready=false\n')
  await expect(node(plan, [], { GITHUB_EVENT_NAME: 'workflow_dispatch' })).rejects.toThrow()
  await expect(node(plan, [], { REQUESTED_TAG: '../../main' })).rejects.toThrow()
})

it('已有版本标签解析到固定提交；非 main 历史的标签拒绝发布', async () => {
  await repository()
  await git('tag', 'v0.0.1')
  await node(plan)
  const commit = (await git('rev-parse', 'HEAD')).stdout.trim()
  expect(await readFile(output(), 'utf8')).toBe(`ready=true\ntag=v0.0.1\ncommit=${commit}\n`)
  await git('checkout', '-b', 'outside')
  await writeFile(join(work, 'package.json'), JSON.stringify({ ...source, version: '0.0.2' }))
  await git('add', 'package.json')
  await git('-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'outside')
  await git('tag', 'v0.0.2')
  await expect(node(plan, [], { REQUESTED_TAG: 'v0.0.2' })).rejects.toThrow()
}, 15_000)

it('标签推送使用事件中的标签，手动恢复使用指定标签', async () => {
  await repository()
  await git('tag', 'v0.0.1')
  await node(plan, [], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.1', REQUESTED_TAG: 'v9.9.9' })
  expect(await readFile(output(), 'utf8')).toContain('tag=v0.0.1\n')
  await node(plan, [], { GITHUB_EVENT_NAME: 'workflow_dispatch', REQUESTED_TAG: 'v0.0.1' })
  expect(await readFile(output(), 'utf8')).toContain('ready=true\n')
}, 15_000)

const archiveBytes = Buffer.from('fixed release archive')
const integrity = `sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`
it.each([
  { status: 404, metadata: {}, expected: false, required: false },
  { status: 200, metadata: { ...source, dist: { integrity } }, expected: true, required: false },
  { status: 200, metadata: { ...source, dist: { integrity: 'sha512-different' } }, expected: undefined, required: false },
  { status: 503, metadata: {}, expected: undefined, required: false },
  { status: 404, metadata: {}, expected: undefined, required: true },
  { status: 200, metadata: { ...source, dist: { integrity } }, expected: true, required: true },
])('npm 检查响应 $status，严格校验 $required，已发布状态 $expected', async ({ status, metadata, expected, required }) => {
  await writeFile(join(work, 'release.tgz'), archiveBytes)
  const server = createServer((_request, response) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(metadata)) })
  await new Promise<void>(done => { server.listen(0, '127.0.0.1', done) })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected test server address')
    const check = node(checkNpm, ['release.tgz', 'package.json', `http://127.0.0.1:${address.port}`], { NPM_REQUIRE_PUBLISHED: String(required), NPM_VERIFY_WAIT_SECONDS: '0' })
    if (expected === undefined) await expect(check).rejects.toThrow()
    else {
      await check
      expect(await readFile(output(), 'utf8')).toBe(`published=${expected}\n`)
    }
  } finally { await new Promise<void>((done, reject) => { server.close(error => { if (error) reject(error); else done() }) }) }
})

it('恢复发布按原标签的 manifest 验证安装包，不使用当前自动化版本替代', async () => {
  await mkdir(join(work, 'package'))
  await mkdir(join(work, 'release'))
  await writeFile(join(work, 'package', 'package.json'), JSON.stringify(source))
  await writeFile(join(work, 'tag-source.json'), JSON.stringify(source))
  await writeFile(join(work, 'package.json'), JSON.stringify({ ...source, version: '0.0.2' }))
  const filename = 'dsh-journal-club-0.0.1.tgz'
  await exec('tar', ['-czf', join('release', filename), 'package/package.json'], { cwd: work })
  const hash = createHash('sha256').update(await readFile(join(work, 'release', filename))).digest('hex')
  await writeFile(join(work, 'release', `${filename}.sha256`), `${hash}  ${filename}\n`)
  await node(verifyAsset, ['v0.0.1', 'release', 'tag-source.json'])
  expect(await readFile(output(), 'utf8')).toContain('dist_tag=latest\n')
  await expect(node(verifyAsset, ['v0.0.1', 'release'])).rejects.toThrow()
})
