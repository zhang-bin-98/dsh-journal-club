// 生成合成旋转页 fixture：tests/fixtures/papers/rotated-landscape.pdf
// 一页 MediaBox 612x792 + /Rotate 90（渲染为 792x612 横排），内容含
// 标题文字与一个纯蓝色矩形（供测试在渲染图上定位、验证旋转后基准的 bbox 裁切）。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 内容：左下角蓝色矩形（用户空间 72,72 - 272,172）+ 顶部标题 + 细线。
const content = [
  'BT /F1 24 Tf 72 700 Td (ROTATED PAGE TEST - blue box at bottom-left in user space) Tj ET',
  '0 0 1 rg 72 72 200 100 re f',
  '0.8 w 0 0 0 RG',
  '72 300 m 540 300 l s',
  '72 350 m 540 350 l s',
  '72 400 m 540 400 l s',
].join('\n')

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream`,
]

let pdf = '%PDF-1.4\n'
const offsets = []
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj ${objects[i]} endobj\n`
}
const xrefOffset = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const offset of offsets) {
  pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'papers', 'rotated-landscape.pdf')
writeFileSync(out, pdf, 'binary')
console.log(`written ${out} (${Buffer.byteLength(pdf)} bytes)`)
