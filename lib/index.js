/**
 * dsh-ui-visibility — host 半。
 *
 * 本插件**没有服务端职责**：显隐名单存在浏览器 localStorage 里，
 * 靠 client 半注入 CSS 实现。这里只提供一个合法的 Cordis 插件空壳，
 * 让 bundle 能正常装载。
 */
export const name = 'dsh-ui-visibility'
export const inject = []

export function apply() {
  // 有意为空：一切逻辑在前端。见 lib/client.js。
}
