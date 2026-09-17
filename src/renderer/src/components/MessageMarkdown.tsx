import { memo } from 'react'
import { Streamdown, type Components } from 'streamdown'
import { cjk } from '@streamdown/cjk'

// Use semantic elements styled by the chat theme, without introducing a
// global Tailwind reset or Streamdown's document-sized controls into bubbles.
const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
  table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
  a: ({ children, href, title }) =>
    href && /^(https?:|mailto:)/i.test(href)
      ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>
}
const plugins = { cjk }
const noRawHtmlPlugins: [] = []

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return <Streamdown
    className="message-markdown"
    mode="static"
    plugins={plugins}
    components={components}
    controls={false}
    skipHtml
    rehypePlugins={noRawHtmlPlugins}
  >{text}</Streamdown>
})
