const IMAGE_TOOLS = ['generate_image', 'edit_image', 'restore_image', 'generate_icon', 'generate_pattern', 'generate_story', 'generate_diagram']

// Match only the installed Nano Banana server, never another MCP server with
// a similarly named tool. CLI names are fully qualified as mcp_<server>_<tool>.
export function isGeminiImageTool(name: unknown): boolean {
  return typeof name === 'string' && IMAGE_TOOLS.some(tool => name === `mcp_nanobanana_${tool}`)
}

export function geminiImagePolicy(allowed = true): string {
  const names = JSON.stringify(IMAGE_TOOLS)
  return `[[rule]]\nmcpName = "nanobanana"\ntoolName = ${names}\ndecision = "${allowed ? 'allow' : 'deny'}"\npriority = 10\n\n`
    // Images belong in the conversation. Don't authorize the extension to
    // launch an external viewer as a side effect of these headless calls.
    + `[[rule]]\nmcpName = "nanobanana"\ntoolName = ${names}\nargsPattern = '"preview":true'\ndecision = "deny"\npriority = 11\n`
}

type Tool = { image: boolean; finished: boolean; error?: string }
type Event = { type?: string; role?: string; content?: string; tool_name?: string; tool_id?: string; status?: string; error?: { message?: string }; message?: string; severity?: string }

/** Native Gemini CLI stream-json. Progress comes from tool events, not the
 * model's claims; user messages, arguments and tool contents stay off the UI. */
export class GeminiStream {
  private buffer = ''
  private text = ''
  private ended = false
  private failure?: string
  private tools = new Map<string, Tool>()
  detail = 'Local agent is running'
  constructor(private readonly progress: (detail: string) => void = () => {}) {}

  push(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.line(line)
    }
  }

  private line(line: string): void {
    if (!line.trim()) return
    let event: Event
    try { event = JSON.parse(line) } catch { this.failure = 'Invalid Gemini event stream'; return }
    if (!event || typeof event !== 'object') { this.failure = 'Invalid Gemini event stream'; return }
    if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') this.text += event.content
    if (event.type === 'error' && event.severity === 'error') this.failure = event.message || 'Gemini failed'
    if (event.type === 'result') {
      this.ended = true
      if (event.status !== 'success' || event.error) this.failure = event.error?.message || 'Gemini stopped before completing the task'
    }
    if (typeof event.tool_id !== 'string') return
    if (event.type === 'tool_use') this.tools.set(event.tool_id, { image: isGeminiImageTool(event.tool_name), finished: false })
    const tool = this.tools.get(event.tool_id)
    if (!tool || !['tool_use', 'tool_result'].includes(event.type ?? '')) return
    if (event.type === 'tool_result') {
      tool.finished = true
      if (event.status !== 'success' || event.error) tool.error = event.error?.message || 'The image tool failed or was denied.'
    }
    const active = [...this.tools.values()].filter(tool => !tool.finished)
    this.detail = active.some(tool => tool.image) ? 'Generating an image; waiting for the tool result'
      : active.length ? 'Running a tool' : tool.image ? tool.error ? 'Image generation failed' : 'Image generated; preparing the result'
        : 'Preparing the result'
    this.progress(this.detail)
  }

  finish(): { text: string; imageToolsSucceeded: boolean } {
    if (this.buffer) { this.line(this.buffer); this.buffer = '' }
    const images = [...this.tools.values()].filter(tool => tool.image)
    const failed = images.find(tool => tool.error)
    if (failed) throw new Error(`Gemini: Image generation failed. ${failed.error}`)
    if (this.failure) throw new Error(`Gemini: ${this.failure}`)
    if (!this.ended || [...this.tools.values()].some(tool => !tool.finished)) throw new Error('Gemini: Incomplete event stream; task stopped')
    return { text: this.text.trim(), imageToolsSucceeded: images.some(tool => tool.finished && !tool.error) }
  }
}
