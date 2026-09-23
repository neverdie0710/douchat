/** Grok Build's native `streaming-json` protocol. Never display thought events,
 * raw tool input, or file contents as progress. */
type Event = Record<string, unknown>
type Tool = { image: boolean; status: string; path?: string; error?: string }

export class GrokStream {
  private buffer = ''
  private text = ''
  private tools = new Map<string, Tool>()
  private ended = false
  private failure?: string
  sessionId?: string
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

  private report(detail: string): void {
    this.detail = detail
    this.progress(detail)
  }

  private line(line: string): void {
    if (!line.trim()) return
    let event: Event
    try { event = JSON.parse(line) } catch { this.failure = 'Invalid Grok event stream'; return }
    if (!event || typeof event !== 'object') { this.failure = 'Invalid Grok event stream'; return }
    if (event.type === 'text' && typeof event.data === 'string') this.text += event.data
    if (event.type === 'error') this.failure = typeof event.message === 'string' ? event.message : 'Grok failed'
    if (event.type === 'max_turns_reached') this.failure = 'Grok stopped before completing the task (max_turns_reached)'
    if (event.type === 'end') {
      this.ended = true
      if (typeof event.sessionId === 'string') this.sessionId = event.sessionId
      if (event.stopReason !== 'end_turn') this.failure ??= `Grok stopped before completing the task (${event.stopReason})`
    }
    if ((event.type !== 'tool_call' && event.type !== 'tool_call_update') || typeof event.toolCallId !== 'string') return
    if (event.type === 'tool_call') {
      this.tools.set(event.toolCallId, {
        image: event.toolName === 'image_gen' || event.toolName === 'image_edit',
        status: typeof event.status === 'string' ? event.status : 'pending'
      })
    }
    const tool = this.tools.get(event.toolCallId)
    if (!tool) return
    if (typeof event.status === 'string') tool.status = event.status
    const output = event.rawOutput as Event | null | undefined
    if (tool.image && tool.status === 'completed' && output
      && (output.type === 'ImageGen' || output.type === 'ImageEdit') && typeof output.path === 'string') tool.path = output.path
    if (tool.image && (tool.status === 'failed' || (tool.status === 'completed' && !tool.path))) {
      // A tier/permission rejection may arrive as a completed Text result.
      // Preserve the actual diagnostic, but never call it a generated image.
      const content = Array.isArray(event.content) ? event.content : []
      tool.error = content.map(item => item?.type === 'content' && item.content?.type === 'text' ? item.content.text : '')
        .filter(item => typeof item === 'string').join('\n').slice(0, 1200)
        || 'The image tool did not produce an image.'
    }
    const active = [...this.tools.values()].filter(item => !['completed', 'failed'].includes(item.status))
    const image = active.find(item => item.image)
    // Grok currently keeps image calls `pending` until their terminal event;
    // don't invent finer-grained stages or a percentage from elapsed time.
    this.report(image ? 'Generating an image; waiting for the tool result'
      : active.length ? 'Running a tool'
        : tool.image && tool.error ? 'Image generation failed'
          : tool.image ? 'Image generated; preparing the result' : 'Preparing the result')
  }

  finish(): { text: string; paths: string[]; sessionId?: string } {
    if (this.buffer) { this.line(this.buffer); this.buffer = '' }
    const images = [...this.tools.values()].filter(tool => tool.image)
    const failed = images.find(tool => tool.error)
    if (failed) throw new Error(`Grok: Image generation failed. ${failed.error}`)
    if (this.failure) throw new Error(`Grok: ${this.failure}`)
    if (!this.ended || [...this.tools.values()].some(tool => !['completed', 'failed'].includes(tool.status))) {
      throw new Error('Grok stopped before completing the task (incomplete event stream)')
    }
    return { text: this.text.trim(), paths: [...new Set(images.flatMap(tool => tool.path ? [tool.path] : []))], sessionId: this.sessionId }
  }
}
