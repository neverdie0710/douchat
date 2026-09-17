/**
 * A CLI agent reports a failure as its echoed transcript followed by a run of
 * `ERROR:` segments — the retries first, then the real cause, usually repeated
 * verbatim. Pasting all of that into the thread buries the one line a person
 * can act on, so the chat shows a headline and keeps the raw text behind a
 * disclosure.
 */

export interface RuntimeErrorSummary {
  /** One line naming what went wrong and the facts needed to fix it. */
  title: string
  /** The untouched original, for the details disclosure. */
  detail: string
}

const RETRY = /^Reconnecting\b/i
const TITLE_LIMIT = 180

export function summarizeRuntimeError(raw: string): RuntimeErrorSummary {
  const detail = String(raw ?? '').trim()
  const flat = detail.replace(/\s+/g, ' ')
  if (!flat) return { title: 'The conversation could not finish.', detail }

  const segments = flat
    .split(/ERROR:\s*/i)
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean)
  const retries = segments.filter((part) => RETRY.test(part)).length
  const causes = segments.filter((part) => !RETRY.test(part))
  // The last real cause wins: earlier ones are retries of the same call.
  const source = causes[causes.length - 1] ?? (segments.length ? '' : flat)

  const status = statusCode(source)
  const facts = [
    status ? `HTTP ${status}` : '',
    field(source, 'Provider'),
    field(source, 'model'),
    reason(source),
    retries ? `after ${retries} ${retries === 1 ? 'retry' : 'retries'}` : ''
  ].filter(Boolean)

  const headline = describe(source, status, retries)
  return { title: clip(facts.length ? `${headline} · ${facts.join(' · ')}` : headline), detail }
}

function describe(source: string, status: number | undefined, retries: number): string {
  if (status === 401 || status === 403) return 'The model endpoint rejected the request'
  if (status === 404) return 'The model endpoint was not found'
  if (status === 408 || status === 504) return 'The model endpoint timed out'
  if (status === 429) return 'The provider is rate limiting this key'
  if (status && status >= 500) return 'The provider returned a server error'
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|fetch failed/i.test(source)) {
    return 'Could not reach the model endpoint'
  }
  if (!source && retries) return 'Lost the connection to the model endpoint'
  return firstSentence(source) || 'The conversation could not finish'
}

function statusCode(source: string): number | undefined {
  const match =
    /unexpected status (\d{3})/i.exec(source) ??
    /upstream_status:\s*HTTP\/?[\d.]*\s*(\d{3})/i.exec(source) ??
    /\bstatus(?:_code)?[:=]\s*(\d{3})\b/i.exec(source) ??
    /\b(\d{3})\s+(?:Unauthorized|Forbidden|Not Found|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i.exec(
      source
    )
  const code = match ? Number(match[1]) : Number.NaN
  return code >= 100 && code <= 599 ? code : undefined
}

/** Reads a `Name: value` field out of a semicolon-separated tail. */
function field(source: string, name: string): string {
  return new RegExp(`\\b${name}:\\s*([^;,]+)`, 'i').exec(source)?.[1].trim() ?? ''
}

function reason(source: string): string {
  const value = /\bcause:\s*([^;]+?)\s*(?:,\s*url:|;|$)/i.exec(source)?.[1] ?? ''
  return value.trim().replace(/\.$/, '')
}

function firstSentence(source: string): string {
  const stop = source.search(/[.!?](\s|$)/)
  return (stop > 0 ? source.slice(0, stop) : source).trim()
}

function clip(text: string): string {
  return text.length <= TITLE_LIMIT ? text : `${text.slice(0, TITLE_LIMIT - 1).trimEnd()}…`
}
