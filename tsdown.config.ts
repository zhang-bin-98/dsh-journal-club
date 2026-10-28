import { defineConfig } from 'tsdown'

/**
 * host 半边：src/index.ts → lib/index.js + lib/index.d.ts。
 * 运行时依赖（pdfjs-dist / @napi-rs/canvas / zod 与 dsh 宿主包）保持不打包
 * （deps.neverBundle），由插件自身 dependencies / 宿主 peer 提供，
 * 避免打包 pdfjs worker 之类的动态加载路径。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  hash: false,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-tools',
      'pdfjs-dist',
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      '@napi-rs/canvas',
      'zod',
    ],
  },
})
