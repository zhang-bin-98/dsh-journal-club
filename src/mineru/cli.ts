import { parseArgs } from 'node:util'
import { dirname, join } from 'node:path'
import { parsePaper } from './parse.ts'
import { MineruError, safeError } from './transport.ts'

const HELP = `Journal Club MinerU API runner
node lib/mineru.js <PDF> --output <parse directory> [--id main|supp] [--mode extract|flash]
  --model vlm|pipeline       --pages 1-10,15       --language en
  --ocr true|false           --formula true|false --table true|false
  --download-timeout 600     --request-timeout 60 --poll-timeout 1800  (seconds)
  --retries 2               --restart             --help
Token: MINERU_TOKEN or ~/.mineru/config.yaml. No token is accepted on the command line.
Outputs: parse/<id>/<id>.md, <id>.json + images (precision), parse/manifest.json.
The same command resumes the existing task; --restart explicitly creates a new task.`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string' }, id: { type: 'string' }, mode: { type: 'string' }, model: { type: 'string' }, pages: { type: 'string' }, language: { type: 'string' },
    ocr: { type: 'string' }, formula: { type: 'string' }, table: { type: 'string' }, 'download-timeout': { type: 'string' }, 'request-timeout': { type: 'string' }, 'poll-timeout': { type: 'string' }, retries: { type: 'string' }, restart: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) { console.log(HELP); return }
  if (positionals.length !== 1 || !values.output) throw new MineruError('参数', '需要一个 PDF 和 --output；使用 --help 查看用法')
  if (values.mode && !['extract', 'flash'].includes(values.mode)) throw new MineruError('参数', 'mode 必须为 extract 或 flash')
  if (values.model && !['vlm', 'pipeline'].includes(values.model)) throw new MineruError('参数', 'model 必须为 vlm 或 pipeline')
  const number = (value: string | undefined, fallback: number, min = 1): number => {
    const n = value === undefined ? fallback : Number(value)
    if (!Number.isSafeInteger(n) || n < min || n > 2_000_000) throw new MineruError('参数', '超时或重试次数无效')
    return n
  }
  const boolean = (value?: string): boolean | undefined => {
    if (value === undefined) return undefined
    if (value !== 'true' && value !== 'false') throw new MineruError('参数', '布尔参数必须为 true 或 false')
    return value === 'true'
  }
  const controller = new AbortController()
  const retries = number(values.retries, 2, 0)
  if (retries > 10) throw new MineruError('参数', '重试次数须为 0–10')
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  const result = await parsePaper({
    source: positionals[0]!, output: values.output, id: values.id, mode: values.mode as 'extract' | 'flash' | undefined,
    model: values.model as 'vlm' | 'pipeline' | undefined, pages: values.pages, language: values.language,
    ocr: boolean(values.ocr), formula: boolean(values.formula), table: boolean(values.table),
    downloadTimeoutMs: number(values['download-timeout'], 600) * 1000, requestTimeoutMs: number(values['request-timeout'], 60) * 1000,
    pollTimeoutMs: number(values['poll-timeout'], 1800) * 1000, retries,
    restart: values.restart, signal: controller.signal, onProgress: message => process.stderr.write(message + '\n'),
  })
  console.log(JSON.stringify({ cached: result.cached, directory: result.directory, mode: result.mode, artifact_count: result.artifacts.length, manifest: join(dirname(result.directory), 'manifest.json') }))
}
main().catch(error => { console.error(error instanceof MineruError ? error.message : safeError(error)); process.exitCode = 1 })
