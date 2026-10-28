import type { Context } from '@deepseek-ai/cordis'

/**
 * client 半边空壳（M1）。构建产物为 dsh client-modules 的闭包工厂格式
 * （见 tsdown.client.ts）。JC tab（状态卡/核对工作台/轻发现）在 M4 落地时
 * 注入 @deepseek-ai/dsh-client-ui-sidebar-right 等依赖并在 dsh.client 补
 * inject / external 声明。
 */
export const name = 'dsh-journal-club/client'

export function apply(_ctx: Context): void {
  // M1 无 client 行为；保留注册壳以验证 bundle 链路。
}
