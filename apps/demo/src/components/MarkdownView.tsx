import { useState, useCallback, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { sanitizeUrl } from '../lib/sanitizer'

interface MarkdownViewProps {
  content: string
}

function CodeBlock({ language, code }: { language: string; code: string }) {
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
    <div className="my-3 rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden text-xs font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-zinc-400">
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
      <pre className="p-3 overflow-x-auto text-zinc-200 leading-relaxed whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function renderFormattedInline(text: string): ReactNode[] {
  // Regex to match inline elements: `code`, **bold**, *italic*, [link](url)
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)

  return parts.map((part, idx) => {
    if (!part) return ''

    // Inline code
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[13px]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    // Bold
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      )
    }

    // Italic
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className="italic text-zinc-200">
          {part.slice(1, -1)}
        </em>
      )
    }

    // Link
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const linkText = linkMatch[1]
      const rawUrl = linkMatch[2]
      const safeUrl = sanitizeUrl(rawUrl)
      if (safeUrl) {
        return (
          <a
            key={idx}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 underline hover:text-sky-300"
          >
            {linkText}
          </a>
        )
      }
      return linkText
    }

    return part
  })
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) return null

  // Split content into code blocks and normal paragraphs
  const elements: ReactNode[] = []
  const lines = content.split('\n')
  let inCodeBlock = false
  let codeBlockLang = ''
  let codeBlockLines: string[] = []
  let textBlockLines: string[] = []

  const flushTextBlock = () => {
    if (textBlockLines.length === 0) return
    const rawBlock = textBlockLines.join('\n').trim()
    textBlockLines = []
    if (!rawBlock) return

    const blockParagraphs = rawBlock.split(/\n\s*\n/)
    blockParagraphs.forEach((paragraph, pIdx) => {
      const trimmed = paragraph.trim()
      if (!trimmed) return

      // Header 1
      if (trimmed.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${elements.length}-${pIdx}`} className="text-xl font-bold text-zinc-100 mt-4 mb-2">
            {renderFormattedInline(trimmed.slice(2))}
          </h1>,
        )
        return
      }

      // Header 2
      if (trimmed.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${elements.length}-${pIdx}`} className="text-lg font-semibold text-zinc-100 mt-3 mb-2">
            {renderFormattedInline(trimmed.slice(3))}
          </h2>,
        )
        return
      }

      // Header 3
      if (trimmed.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${elements.length}-${pIdx}`} className="text-base font-semibold text-zinc-200 mt-3 mb-1">
            {renderFormattedInline(trimmed.slice(4))}
          </h3>,
        )
        return
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        elements.push(
          <blockquote
            key={`bq-${elements.length}-${pIdx}`}
            className="border-l-2 border-zinc-600 pl-3 italic text-zinc-400 my-2"
          >
            {renderFormattedInline(trimmed.slice(2))}
          </blockquote>,
        )
        return
      }

      // Unordered or ordered list
      const pLines = trimmed.split('\n')
      const isList = pLines.every(l => /^[-*]\s+/.test(l.trim()) || /^\d+\.\s+/.test(l.trim()))
      if (isList) {
        elements.push(
          <ul key={`ul-${elements.length}-${pIdx}`} className="list-disc list-inside space-y-1 my-2 text-zinc-300">
            {pLines.map((l, lIdx) => {
              const itemText = l.trim().replace(/^([-*]|\d+\.)\s+/, '')
              return <li key={lIdx}>{renderFormattedInline(itemText)}</li>
            })}
          </ul>,
        )
        return
      }

      // Standard paragraph
      elements.push(
        <p key={`p-${elements.length}-${pIdx}`} className="my-2 text-zinc-200 leading-relaxed">
          {renderFormattedInline(trimmed)}
        </p>,
      )
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <CodeBlock
            key={`cb-${elements.length}`}
            language={codeBlockLang}
            code={codeBlockLines.join('\n')}
          />,
        )
        inCodeBlock = false
        codeBlockLines = []
        codeBlockLang = ''
      } else {
        // Start code block
        flushTextBlock()
        inCodeBlock = true
        codeBlockLang = line.slice(3).trim()
      }
    } else if (inCodeBlock) {
      codeBlockLines.push(line)
    } else {
      textBlockLines.push(line)
    }
  }

  if (inCodeBlock) {
    elements.push(
      <CodeBlock
        key={`cb-${elements.length}`}
        language={codeBlockLang}
        code={codeBlockLines.join('\n')}
      />,
    )
  } else {
    flushTextBlock()
  }

  return <div className="text-sm space-y-1">{elements}</div>
}
