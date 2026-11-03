import { useState, useCallback, isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { sanitizeUrl } from '../lib/sanitizer'

interface MarkdownViewProps {
  content: string
}

interface CodeBlockProps {
  language: string
  code: string
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ''
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore clipboard write failures
    }
  }, [code])

  return (
    <div className="my-3 rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden text-xs font-mono shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 select-none">
        <span>{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1 hover:text-zinc-200 transition text-[11px]"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-zinc-200 leading-relaxed font-mono whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const markdownComponents: Components = {
  pre({ children }) {
    if (isValidElement(children)) {
      const codeProps = children.props as { className?: string; children?: ReactNode }
      const className = codeProps.className || ''
      const match = /language-([a-zA-Z0-9_-]+)/.exec(className)
      const language = match ? match[1] : ''
      const rawCode = extractText(codeProps.children)
      const code = rawCode.replace(/\n$/, '')
      return <CodeBlock language={language} code={code} />
    }
    return (
      <div className="my-3 rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden text-xs font-mono shadow-xs">
        <pre className="p-3 overflow-x-auto text-zinc-200 leading-relaxed font-mono whitespace-pre">
          {children}
        </pre>
      </div>
    )
  },
  code({ className, children, ...props }) {
    return (
      <code
        className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-200 font-mono text-[13px] border border-zinc-700/50"
        {...props}
      >
        {children}
      </code>
    )
  },
  table({ children, ...props }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 shadow-xs">
        <table className="w-full text-left text-xs border-collapse" {...props}>
          {children}
        </table>
      </div>
    )
  },
  thead({ children, ...props }) {
    return (
      <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-200" {...props}>
        {children}
      </thead>
    )
  },
  tbody({ children, ...props }) {
    return (
      <tbody className="divide-y divide-zinc-800/60" {...props}>
        {children}
      </tbody>
    )
  },
  tr({ children, ...props }) {
    return (
      <tr className="hover:bg-zinc-900/40 transition-colors" {...props}>
        {children}
      </tr>
    )
  },
  th({ children, ...props }) {
    return (
      <th className="px-3.5 py-2 font-semibold text-zinc-100 whitespace-nowrap" {...props}>
        {children}
      </th>
    )
  },
  td({ children, ...props }) {
    return (
      <td className="px-3.5 py-2 text-zinc-300 leading-normal" {...props}>
        {children}
      </td>
    )
  },
  ul({ className, children, ...props }) {
    const isTaskList = className?.includes('contains-task-list')
    return (
      <ul
        className={
          isTaskList
            ? 'my-2 space-y-1.5 list-none pl-1 text-zinc-300'
            : 'my-2 ml-5 list-disc space-y-1 text-zinc-300 [&_ul]:my-1 [&_ul]:ml-4 [&_ul]:list-[circle] [&_ol]:my-1 [&_ol]:ml-4'
        }
        {...props}
      >
        {children}
      </ul>
    )
  },
  ol({ children, ...props }) {
    return (
      <ol
        className="my-2 ml-5 list-decimal space-y-1 text-zinc-300 [&_ol]:my-1 [&_ol]:ml-4 [&_ol]:list-[lower-alpha] [&_ul]:my-1 [&_ul]:ml-4 [&_ul]:list-disc"
        {...props}
      >
        {children}
      </ol>
    )
  },
  li({ className, children, ...props }) {
    const isTaskItem = className?.includes('task-list-item')
    return (
      <li
        className={
          isTaskItem
            ? 'flex items-start gap-2 leading-relaxed text-zinc-300'
            : 'leading-relaxed text-zinc-300'
        }
        {...props}
      >
        {children}
      </li>
    )
  },
  input({ type, ...props }) {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          className="mt-1 h-3.5 w-3.5 rounded border border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-default"
          readOnly
          {...props}
        />
      )
    }
    return <input type={type} {...props} />
  },
  h1({ children, ...props }) {
    return (
      <h1 className="text-xl font-bold text-zinc-100 mt-4 mb-2 first:mt-0 tracking-tight" {...props}>
        {children}
      </h1>
    )
  },
  h2({ children, ...props }) {
    return (
      <h2 className="text-lg font-semibold text-zinc-100 mt-3.5 mb-2 first:mt-0 tracking-tight" {...props}>
        {children}
      </h2>
    )
  },
  h3({ children, ...props }) {
    return (
      <h3 className="text-base font-semibold text-zinc-200 mt-3 mb-1.5 first:mt-0" {...props}>
        {children}
      </h3>
    )
  },
  h4({ children, ...props }) {
    return (
      <h4 className="text-sm font-semibold text-zinc-200 mt-2.5 mb-1 first:mt-0" {...props}>
        {children}
      </h4>
    )
  },
  h5({ children, ...props }) {
    return (
      <h5 className="text-xs font-semibold uppercase text-zinc-400 tracking-wider mt-2 mb-1 first:mt-0" {...props}>
        {children}
      </h5>
    )
  },
  h6({ children, ...props }) {
    return (
      <h6 className="text-xs font-semibold text-zinc-400 mt-2 mb-1 first:mt-0" {...props}>
        {children}
      </h6>
    )
  },
  p({ children, ...props }) {
    return (
      <p className="my-2 leading-relaxed text-zinc-200 first:mt-0 last:mb-0" {...props}>
        {children}
      </p>
    )
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="border-l-2 border-zinc-600 pl-3.5 my-2.5 italic text-zinc-400 bg-zinc-900/30 py-1 rounded-r"
        {...props}
      >
        {children}
      </blockquote>
    )
  },
  hr({ ...props }) {
    return <hr className="my-4 border-zinc-800" {...props} />
  },
  a({ href, children, ...props }) {
    const safeUrl = href ? sanitizeUrl(href) : null
    if (!safeUrl) {
      return <span className="text-zinc-400">{children}</span>
    }
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 underline underline-offset-2 hover:text-sky-300 transition"
        {...props}
      >
        {children}
      </a>
    )
  },
  strong({ children, ...props }) {
    return <strong className="font-semibold text-zinc-100" {...props}>{children}</strong>
  },
  em({ children, ...props }) {
    return <em className="italic text-zinc-200" {...props}>{children}</em>
  },
  del({ children, ...props }) {
    return <del className="line-through text-zinc-400" {...props}>{children}</del>
  },
}

const remarkPlugins = [remarkGfm]

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) return null

  return (
    <div className="text-sm space-y-1">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={url => sanitizeUrl(url) ?? ''}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
