/**
 * Google Docs ↔ markdown conversion.
 *
 * Two pure, side-effect-free functions:
 *
 *   docsToMarkdown(doc)         — Docs `documents.get` response → markdown string
 *   markdownToDocsRequests(md)  → Google Docs `batchUpdate` `Request[]` that, when
 *                                 applied to a *blank* newly-created document,
 *                                 produces the equivalent formatted content.
 *
 * Scope of support (v1):
 *   headings H1-H6, paragraphs, bold, italic, inline code, links,
 *   bullet/ordered lists (single level), horizontal rules.
 *
 * Explicitly out of scope (documented limitation):
 *   tables, images, footnotes, nested lists. These render as plain-text
 *   placeholders (`[table omitted]`, etc.) going Docs→md, and fall back to
 *   plain text going md→Docs.
 *
 * This module intentionally depends only on `mdast-util-from-markdown` +
 * `mdast-util-gfm`; it has no HTTP and no Docs API client — it's
 * unit-testable in isolation.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type {
  Root,
  RootContent,
  Paragraph,
  Heading,
  List,
  ListItem,
  PhrasingContent,
  Text,
  Emphasis,
  Strong,
  InlineCode,
  Link,
  Break,
} from 'mdast'

// ---------------------------------------------------------------------------
// Docs API response types (narrow shape we actually read)
// ---------------------------------------------------------------------------

type NamedStyleType =
  | 'NORMAL_TEXT'
  | 'TITLE'
  | 'SUBTITLE'
  | 'HEADING_1' | 'HEADING_2' | 'HEADING_3'
  | 'HEADING_4' | 'HEADING_5' | 'HEADING_6'

interface TextStyle {
  bold?: boolean
  italic?: boolean
  link?: { url?: string }
  weightedFontFamily?: { fontFamily?: string }
}

interface TextRun {
  content?: string
  textStyle?: TextStyle
}

interface ParagraphElement {
  textRun?: TextRun
  horizontalRule?: Record<string, unknown>
}

interface DocsParagraph {
  elements?: ParagraphElement[]
  paragraphStyle?: { namedStyleType?: NamedStyleType }
  bullet?: { listId?: string; nestingLevel?: number }
}

interface DocsContentElement {
  paragraph?: DocsParagraph
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{ content?: DocsContentElement[] }>
    }>
  }
  tableOfContents?: { content?: DocsContentElement[] }
  sectionBreak?: unknown
}

interface Lists {
  [listId: string]: {
    listProperties?: {
      nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string }>
    }
  }
}

export interface DocsDocument {
  title?: string
  body?: { content?: DocsContentElement[] }
  lists?: Lists
}

// ---------------------------------------------------------------------------
// Docs → markdown
// ---------------------------------------------------------------------------

const HEADING_PREFIX: Record<string, string> = {
  TITLE: '# ',
  HEADING_1: '# ',
  HEADING_2: '## ',
  HEADING_3: '### ',
  HEADING_4: '#### ',
  HEADING_5: '##### ',
  HEADING_6: '###### ',
}

export function docsToMarkdown(doc: DocsDocument): string {
  const content = doc.body?.content ?? []
  const lists = doc.lists ?? {}
  const lines: string[] = []

  for (const el of content) {
    if (el.paragraph) {
      const line = renderParagraph(el.paragraph, lists)
      lines.push(line)
      continue
    }
    if (el.table) {
      lines.push('[table omitted]')
      continue
    }
    if (el.tableOfContents) {
      lines.push('[table of contents omitted]')
      continue
    }
    if (el.sectionBreak) {
      // Section breaks render as blank separators.
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    }
  }

  // Collapse runs of 3+ blank lines to 2, and trim trailing blanks.
  const collapsed: string[] = []
  for (const line of lines) {
    if (line === '' && collapsed.length > 0 && collapsed[collapsed.length - 1] === '') {
      continue
    }
    collapsed.push(line)
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop()

  return collapsed.join('\n')
}

function renderParagraph(p: DocsParagraph, lists: Lists): string {
  const elements = p.elements ?? []

  // Horizontal rule paragraph: single element with horizontalRule.
  if (elements.length === 1 && elements[0].horizontalRule) {
    return '---'
  }

  // Collect text runs into marked-up inline markdown.
  const inline = renderInlineRuns(elements)

  // List item? (Docs uses `bullet` to mark list membership.)
  if (p.bullet) {
    const listId = p.bullet.listId ?? ''
    const level = p.bullet.nestingLevel ?? 0
    const indent = '  '.repeat(Math.max(0, level))
    const glyph = lists[listId]?.listProperties?.nestingLevels?.[level]?.glyphType
    // Google marks ordered lists with DECIMAL / DECIMAL_ALPHA_ROMAN / etc;
    // unordered with GLYPH_TYPE_UNSPECIFIED or falsy.
    const ordered = typeof glyph === 'string' && /DECIMAL|ALPHA|ROMAN/i.test(glyph)
    const marker = ordered ? '1. ' : '- '
    return `${indent}${marker}${inline.trim()}`
  }

  const prefix = HEADING_PREFIX[p.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'] ?? ''
  return `${prefix}${inline.trim()}`
}

function renderInlineRuns(elements: ParagraphElement[]): string {
  let out = ''
  for (const el of elements) {
    const run = el.textRun
    if (!run) continue
    let text = run.content ?? ''
    if (!text) continue
    // Trailing newline on a paragraph's final run is structural — strip it;
    // the caller re-joins paragraphs with '\n'.
    text = text.replace(/\n$/, '')
    if (!text) continue

    const style = run.textStyle ?? {}
    const isCode = /mono/i.test(style.weightedFontFamily?.fontFamily ?? '')
    let wrapped = escapeMarkdown(text)

    if (isCode) wrapped = `\`${text.replace(/`/g, '\\`')}\``
    if (style.bold) wrapped = `**${wrapped}**`
    if (style.italic) wrapped = `*${wrapped}*`
    if (style.link?.url) wrapped = `[${wrapped}](${style.link.url})`

    out += wrapped
  }
  return out
}

function escapeMarkdown(s: string): string {
  // Minimal escaping: only characters that would break round-trip rendering
  // at paragraph start. We deliberately avoid aggressive escaping so the
  // output stays readable for agents.
  return s.replace(/([\\`*_])/g, '\\$1')
}

// ---------------------------------------------------------------------------
// Markdown → Docs batchUpdate requests
// ---------------------------------------------------------------------------

/**
 * Google Docs batchUpdate request type (narrow — only fields we emit).
 *
 * The Docs API uses 1-indexed character positions. A freshly-created blank
 * document has a single trailing newline at index 1, so the first
 * `insertText` request targets `location.index = 1`.
 */
type DocsRequest =
  | { insertText: { location: { index: number }; text: string } }
  | {
      updateParagraphStyle: {
        range: { startIndex: number; endIndex: number }
        paragraphStyle: { namedStyleType: NamedStyleType }
        fields: string
      }
    }
  | {
      updateTextStyle: {
        range: { startIndex: number; endIndex: number }
        textStyle: TextStyle
        fields: string
      }
    }
  | {
      createParagraphBullets: {
        range: { startIndex: number; endIndex: number }
        bulletPreset: string
      }
    }

/**
 * Parse `md` and emit Docs `batchUpdate` `Request[]` that, applied to a
 * freshly-created blank doc, produces the same formatted content.
 *
 * Index discipline:
 *   - Track a running `cursor` (1-indexed character position).
 *   - For each block node, insert its text at `cursor`, then apply block
 *     and inline style requests over the range we just wrote.
 *   - Advance `cursor` by `text.length` after each insertText.
 *
 * Inserts are emitted in *document order*. Style requests reference the
 * range we just wrote, so ordering between inserts and styles only matters
 * relative to later inserts — Docs applies all requests within a single
 * batchUpdate in the order given and the cumulative indices stay correct
 * because styles don't shift indices.
 */
export function markdownToDocsRequests(md: string): DocsRequest[] {
  if (!md.trim()) return []

  const tree = fromMarkdown(md, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Root

  const requests: DocsRequest[] = []
  const state = { cursor: 1 }

  for (const node of tree.children) {
    emitBlock(node, requests, state)
  }

  return requests
}

interface EmitState {
  cursor: number
}

function emitBlock(node: RootContent, reqs: DocsRequest[], state: EmitState): void {
  switch (node.type) {
    case 'heading':
      emitHeading(node, reqs, state)
      return
    case 'paragraph':
      emitParagraph(node, reqs, state)
      return
    case 'list':
      emitList(node, reqs, state)
      return
    case 'thematicBreak':
      // A thematic break is a standalone paragraph in Docs. Emit a newline.
      insertText(reqs, state, '\n')
      return
    case 'code': {
      // Fenced code block → monospace paragraph(s).
      const text = (node.value ?? '') + '\n'
      const start = state.cursor
      insertText(reqs, state, text)
      reqs.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: state.cursor - 1 },
          textStyle: { weightedFontFamily: { fontFamily: 'Roboto Mono' } },
          fields: 'weightedFontFamily',
        },
      })
      return
    }
    case 'blockquote': {
      // Render children as plain paragraphs — Docs' quote styling is
      // non-trivial and not worth the complexity in v1.
      for (const child of node.children) emitBlock(child as RootContent, reqs, state)
      return
    }
    default:
      // Unsupported block types (table, html, etc.) → flatten to text.
      const flat = flattenToText(node as { children?: unknown[] })
      if (flat) insertText(reqs, state, flat + '\n')
      return
  }
}

function emitHeading(node: Heading, reqs: DocsRequest[], state: EmitState): void {
  const start = state.cursor
  renderPhrasing(node.children, reqs, state)
  insertText(reqs, state, '\n')
  const level = Math.min(6, Math.max(1, node.depth))
  reqs.push({
    updateParagraphStyle: {
      range: { startIndex: start, endIndex: state.cursor - 1 },
      paragraphStyle: { namedStyleType: `HEADING_${level}` as NamedStyleType },
      fields: 'namedStyleType',
    },
  })
}

function emitParagraph(node: Paragraph, reqs: DocsRequest[], state: EmitState): void {
  renderPhrasing(node.children, reqs, state)
  insertText(reqs, state, '\n')
}

function emitList(node: List, reqs: DocsRequest[], state: EmitState): void {
  const start = state.cursor
  for (const item of node.children as ListItem[]) {
    // Each list item: emit its paragraph children, but as a single line
    // per item (we don't support multi-paragraph list items in v1).
    for (const child of item.children) {
      if (child.type === 'paragraph') {
        renderPhrasing(child.children, reqs, state)
      } else {
        // Nested list or other block inside a list item → flatten.
        const flat = flattenToText(child as { children?: unknown[] })
        if (flat) insertText(reqs, state, flat)
      }
    }
    insertText(reqs, state, '\n')
  }
  const end = state.cursor - 1
  if (end > start) {
    reqs.push({
      createParagraphBullets: {
        range: { startIndex: start, endIndex: end },
        bulletPreset: node.ordered
          ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
          : 'BULLET_DISC_CIRCLE_SQUARE',
      },
    })
  }
}

/**
 * Emit inserts + updateTextStyle requests for a run of phrasing content.
 * Returns the concatenated plain text (useful for callers that need
 * character counts, though they can also diff `state.cursor`).
 */
function renderPhrasing(
  nodes: PhrasingContent[],
  reqs: DocsRequest[],
  state: EmitState,
): string {
  let accumulated = ''
  for (const node of nodes) {
    accumulated += emitInline(node, reqs, state, {})
  }
  return accumulated
}

interface InlineStyle {
  bold?: boolean
  italic?: boolean
  code?: boolean
  linkUrl?: string
}

function emitInline(
  node: PhrasingContent,
  reqs: DocsRequest[],
  state: EmitState,
  style: InlineStyle,
): string {
  switch (node.type) {
    case 'text': {
      const text = (node as Text).value
      if (!text) return ''
      const start = state.cursor
      insertText(reqs, state, text)
      applyInlineStyle(reqs, start, state.cursor, style)
      return text
    }
    case 'strong': {
      let out = ''
      for (const child of (node as Strong).children) {
        out += emitInline(child, reqs, state, { ...style, bold: true })
      }
      return out
    }
    case 'emphasis': {
      let out = ''
      for (const child of (node as Emphasis).children) {
        out += emitInline(child, reqs, state, { ...style, italic: true })
      }
      return out
    }
    case 'inlineCode': {
      const text = (node as InlineCode).value
      if (!text) return ''
      const start = state.cursor
      insertText(reqs, state, text)
      applyInlineStyle(reqs, start, state.cursor, { ...style, code: true })
      return text
    }
    case 'link': {
      const link = node as Link
      let out = ''
      for (const child of link.children) {
        out += emitInline(child, reqs, state, { ...style, linkUrl: link.url })
      }
      return out
    }
    case 'break': {
      // Soft line break → literal newline inside the paragraph. Docs
      // treats this as a new paragraph, which is the closest equivalent.
      void (node as Break)
      insertText(reqs, state, '\n')
      return '\n'
    }
    default: {
      // Images, html, footnoteReference — flatten to text if possible.
      const flat = flattenToText(node as { children?: unknown[]; value?: unknown })
      if (flat) {
        const start = state.cursor
        insertText(reqs, state, flat)
        applyInlineStyle(reqs, start, state.cursor, style)
        return flat
      }
      return ''
    }
  }
}

function applyInlineStyle(
  reqs: DocsRequest[],
  startIndex: number,
  cursorAfter: number,
  style: InlineStyle,
): void {
  const endIndex = cursorAfter
  if (endIndex <= startIndex) return
  const textStyle: TextStyle = {}
  const fields: string[] = []
  if (style.bold) {
    textStyle.bold = true
    fields.push('bold')
  }
  if (style.italic) {
    textStyle.italic = true
    fields.push('italic')
  }
  if (style.code) {
    textStyle.weightedFontFamily = { fontFamily: 'Roboto Mono' }
    fields.push('weightedFontFamily')
  }
  if (style.linkUrl) {
    textStyle.link = { url: style.linkUrl }
    fields.push('link')
  }
  if (fields.length === 0) return
  reqs.push({
    updateTextStyle: {
      range: { startIndex, endIndex },
      textStyle,
      fields: fields.join(','),
    },
  })
}

function insertText(reqs: DocsRequest[], state: EmitState, text: string): void {
  if (!text) return
  reqs.push({
    insertText: { location: { index: state.cursor }, text },
  })
  state.cursor += text.length
}

function flattenToText(node: { children?: unknown[]; value?: unknown }): string {
  if (typeof node.value === 'string') return node.value
  if (!Array.isArray(node.children)) return ''
  let out = ''
  for (const child of node.children) {
    out += flattenToText(child as { children?: unknown[]; value?: unknown })
  }
  return out
}
