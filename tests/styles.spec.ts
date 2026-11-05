import { afterEach, expect, it, vi } from 'vitest'
import { ensureStyles } from '../src/client/styles.ts'

afterEach(() => vi.unstubAllGlobals())

it('客户端重载时更新已有样式节点，保留单个样式表', () => {
  const stale = { id: 'dsh-journal-club-styles', textContent: '.old {}' }
  const append = vi.fn()
  vi.stubGlobal('document', { getElementById: () => stale, head: { append } })
  ensureStyles()
  expect(stale.textContent).toContain('.jc-inlineDialog')
  expect(stale.textContent).toContain('.jc-confirmBar')
  ensureStyles()
  expect(append).not.toHaveBeenCalled()
})
