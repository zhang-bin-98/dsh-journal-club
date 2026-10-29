import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // PDF 渲染与 PNG 编码为 CPU 密集型，限制并发避免内存峰值。
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
