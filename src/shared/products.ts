/** Our other apps, for Settings → More from Us. The service serves the shared
 * feed at /api/products (Douchat itself left out); this list covers the first
 * run and offline use. */
export interface Product {
  id: string
  name: string
  url: string
  icon?: string
  summary: { en: string; zh: string }
}

export const BUILT_IN_PRODUCTS: Product[] = [
  { id: 'autojev', name: 'AutoJev', url: 'https://autojev.ai', icon: 'https://cdn.snapok.app/products/autojev.png',
    summary: { en: 'A local model gateway for AI agents: route Codex, Claude Code, and more to the right model.', zh: 'AI 智能体的本地模型网关：一个入口接入 Codex、Claude Code 等，自动路由到合适的模型。' } },
  { id: 'fastclaw', name: 'FastClaw', url: 'https://fastclaw.ai', icon: 'https://cdn.snapok.app/products/fastclaw.png',
    summary: { en: 'An agent factory: create AI agents and run them on the web, by API, or in chat apps.', zh: '智能体工厂：创建自己的 AI 智能体，接入网页、API 和聊天应用。' } },
  { id: 'snapok', name: 'Snapok', url: 'https://snapok.app', icon: 'https://snapok.app/logo.png',
    summary: { en: 'A free, native macOS screenshot tool: capture, annotate, and frame, and ask Snapok Agent to redact, mark up, or translate.', zh: '免费开源的 Mac 截图工具：长截图、标注、加背景，还能让 Snapok Agent 帮你打码、圈注和翻译。' } },
  { id: 'spotcat', name: 'Spotcat', url: 'https://spotcat.ai', icon: 'https://cdn.snapok.app/products/spotcat.png',
    summary: { en: 'A fast, native macOS launcher for apps, files, the web, extensions, and AI.', zh: '快速的原生 macOS 启动器：⌥Space 打开应用、文件、网页、扩展和 AI。' } },
  { id: 'termany', name: 'Termany', url: 'https://termany.sh', icon: 'https://cdn.snapok.app/products/termany.png',
    summary: { en: 'The agent-native terminal: run many coding agents in one window.', zh: '为智能体打造的终端：一个窗口同时运行多个编程智能体。' } }
]

const isHttp = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)

/** The well-formed entries of a /api/products answer, or undefined when it has none.
 * Icons may be paths on the service; `base` (the service's address) makes them absolute. */
export function parseProducts(payload: unknown, base?: string): Product[] | undefined {
  const icon = (value: unknown): string | undefined => {
    if (isHttp(value)) return value
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return undefined
    return base ? new URL(value, base).toString() : value
  }
  const list = (payload as { data?: { products?: unknown } })?.data?.products
  if (!Array.isArray(list)) return undefined
  const products = list.flatMap((item): Product[] => {
    const p = item as Partial<Product>
    if (!p.id || !p.name || !isHttp(p.url) || !p.summary?.en || !p.summary?.zh) return []
    const src = icon(p.icon)
    return [{ id: p.id, name: p.name, url: p.url, ...(src ? { icon: src } : {}), summary: { en: p.summary.en, zh: p.summary.zh } }]
  })
  return products.length ? products : undefined
}

/** The product's link tagged with where the visit came from, keeping any query it has. */
export function productLink(product: Product, source: string): string {
  try {
    const url = new URL(product.url)
    url.searchParams.set('utm_source', source)
    return url.toString()
  } catch { return product.url }
}
