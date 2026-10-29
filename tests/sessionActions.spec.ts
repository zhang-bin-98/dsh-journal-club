import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { sendSessionMessage } from '../src/client/sessionActions.ts'

describe('宿主会话动作', () => {
  it('从借用的真实 Cordis scope 获取服务，并保留目标会话上下文', async () => {
    const root = new Context()
    const messages: { session: string; text: string }[] = []
    const sessionTag = Symbol('session')
    class Conversation extends Service {
      constructor(ctx: Context) { super(ctx, 'conversation') }
      async send(text: string) {
        messages.push({ session: (this.ctx as Context & { [sessionTag]: string })[sessionTag], text })
      }
    }
    const provider = await root.plugin(ctx => { new Conversation(ctx) })
    let borrowed!: Context
    const owner = await root.plugin(ctx => { borrowed = ctx.extend({ [sessionTag]: 'paper-session' }) })
    try {
      // The host owns this scope; the caller's inject list does not apply to it.
      expect(() => (borrowed as unknown as { conversation: unknown }).conversation).toThrow(/without inject/)
      await sendSessionMessage({ scope: () => borrowed }, 'paper-session', '/jc confirm outline')
      expect(messages).toEqual([{ session: 'paper-session', text: '/jc confirm outline' }])
    } finally {
      await owner.dispose()
      await provider.dispose()
    }
  })

  it('会话或服务已释放时明确报错，不发送到其他会话', async () => {
    await expect(sendSessionMessage({ scope: () => undefined }, 'gone', 'continue')).rejects.toThrow('会话未加载')
    await expect(sendSessionMessage({ scope: () => ({ get: () => undefined }) }, 'gone', 'continue')).rejects.toThrow('会话服务暂不可用')
  })
})
