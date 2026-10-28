import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * client 半边：src/client/index.ts → lib/client.js。
 * 产物是 dsh client-modules 的闭包工厂格式（参照 deepseek-harness
 * packages/client/tsdown.client.ts 的产出契约）：
 *
 *   window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     <CJS bundle 体，require(...) 解析模块表外部依赖>
 *   return module.exports; } });
 *
 * externals 只允许是平台基线模块表（react / react-dom / @deepseek-ai/cordis /
 * zod / dsh-client-* 基线），非基线请求必须列入 package.json 的
 * dsh.client.external 并声明对应 client 插件依赖（M4 引入工作台时补）。
 */
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  clean: false,
  hash: false,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: { neverBundle: PLATFORM_MODULES },
  // tsdown 不透传 rolldown 的 intro/outro（静默丢弃），包装整体放 banner/footer。
  banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  footer: 'return module.exports; } });',
})
