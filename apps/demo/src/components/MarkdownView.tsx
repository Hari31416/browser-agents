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

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|')
  if (cells.length === 0) return false
  return cells.every(c => /^\s*:?-{2,}:?\s*$/.test(c))
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|')
}

function parseTableAlignments(separator: string): Array<'left' | 'center' | 'right' | undefined> {
  const cells = separator.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.map(cell => {
    const trimmed = cell.trim()
    const left = trimmed.startsWith(':')
    const right = trimmed.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return undefined
  })
}

function parseTableCells(row: string): string[] {
  let trimmed = row.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map(c => c.trim())
}

function renderBlockElements(lines: string[]): ReactNode[] {
  const elements: ReactNode[] = []
  let pendingParagraphLines: string[] = []

  const flushParagraph = () => {
    if (pendingParagraphLines.length === 0) return
    const text = pendingParagraphLines.join('\n').trim()
    pendingParagraphLines = []
    if (!text) return

    // Header 1
    if (text.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${elements.length}`} className="text-xl font-bold text-zinc-100 mt-4 mb-2">
          {renderFormattedInline(text.slice(2))}
        </h1>,
      )
      return
    }

    // Header 2
    if (text.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${elements.length}`} className="text-lg font-semibold text-zinc-100 mt-3 mb-2">
          {renderFormattedInline(text.slice(3))}
        </h2>,
      )
      return
    }

    // Header 3
    if (text.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${elements.length}`} className="text-base font-semibold text-zinc-200 mt-3 mb-1">
          {renderFormattedInline(text.slice(4))}
        </h3>,
      )
      return
    }

    // Blockquote
    if (text.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`bq-${elements.length}`}
          className="border-l-2 border-zinc-600 pl-3 italic text-zinc-400 my-2"
        >
          {renderFormattedInline(text.slice(2))}
        </blockquote>,
      )
      return
    }

    // Unordered or ordered list
    const pLines = text.split('\n')
    const isList = pLines.every(l => /^[-*]\s+/.test(l.trim()) || /^\d+\.\s+/.test(l.trim()))
    if (isList) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-2 text-zinc-300">
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
      <p key={`p-${elements.length}`} className="my-2 text-zinc-200 leading-relaxed">
        {renderFormattedInline(text)}
      </p>,
    )
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line
    if (!trimmed) {
      flushParagraph()
      i++
      continue
    }

    // Table detection: current line has pipes and next line is separator
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph()
      const headerLine = trimmed
      const separatorLine = lines[i + 1]
      const alignments = parseTableAlignments(separatorLine)
      const headers = parseTableCells(headerLine)

      i += 2
      const rows: string[][] = []
      while (
        i < lines.length &&
        isTableRow(lines[i].trim()) &&
        !lines[i].trim().startsWith('#') &&
        lines[i].trim() !== ''
      ) {
        rows.push(parseTableCells(lines[i]))
        i++
      }

      elements.push(
        <div
          key={`table-${elements.length}`}
          className="my-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 shadow-xs"
        >
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-200">
              <tr>
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    className="px-3.5 py-2 font-semibold text-zinc-100 whitespace-nowrap"
                    style={{ textAlign: alignments[hIdx] }}
                  >
                    {renderFormattedInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-zinc-900/40 transition-colors">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3.5 py-2 text-zinc-300 leading-normal"
                      style={{ textAlign: alignments[cIdx] }}
                    >
                      {renderFormattedInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Header or Blockquote boundary
    if (
      trimmed.startsWith('# ') ||
      trimmed.startsWith('## ') ||
      trimmed.startsWith('### ') ||
      trimmed.startsWith('> ')
    ) {
      flushParagraph()
      pendingParagraphLines.push(trimmed)
      flushParagraph()
      i++
      continue
    }

    pendingParagraphLines.push(line)
    i++
  }

  flushParagraph()
  return elements
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) return null

  // Split content into code blocks and normal markdown blocks
  const elements: ReactNode[] = []
  const lines = content.split('\n')
  let inCodeBlock = false
  let codeBlockLang = ''
  let codeBlockLines: string[] = []
  let textBlockLines: string[] = []

  const flushText = () => {
    if (textBlockLines.length === 0) return
    const blockElements = renderBlockElements(textBlockLines)
    elements.push(...blockElements)
    textBlockLines = []
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
        flushText()
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
    flushText()
  }

  return <div className="text-sm space-y-1">{elements}</div>
}
