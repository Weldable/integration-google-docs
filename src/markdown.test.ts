/**
 * Unit tests for markdown.ts. Run with `npx tsx --test src/markdown.test.ts`
 * from the integration-google-docs package root.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docsToMarkdown, markdownToDocsRequests, type DocsDocument } from './markdown'

// ---------------------------------------------------------------------------
// docsToMarkdown
// ---------------------------------------------------------------------------

test('docsToMarkdown: plain paragraph', () => {
  const doc: DocsDocument = {
    body: {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), 'Hello world')
})

test('docsToMarkdown: headings', () => {
  const doc: DocsDocument = {
    body: {
      content: [
        {
          paragraph: {
            paragraphStyle: { namedStyleType: 'HEADING_1' },
            elements: [{ textRun: { content: 'Title\n' } }],
          },
        },
        {
          paragraph: {
            paragraphStyle: { namedStyleType: 'HEADING_2' },
            elements: [{ textRun: { content: 'Sub\n' } }],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), '# Title\n## Sub')
})

test('docsToMarkdown: bold and italic inline styles', () => {
  const doc: DocsDocument = {
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: 'This is ' } },
              { textRun: { content: 'bold', textStyle: { bold: true } } },
              { textRun: { content: ' and ' } },
              { textRun: { content: 'italic', textStyle: { italic: true } } },
              { textRun: { content: '.\n' } },
            ],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), 'This is **bold** and *italic*.')
})

test('docsToMarkdown: link', () => {
  const doc: DocsDocument = {
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: 'See ' } },
              {
                textRun: {
                  content: 'Google',
                  textStyle: { link: { url: 'https://google.com' } },
                },
              },
              { textRun: { content: '.\n' } },
            ],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), 'See [Google](https://google.com).')
})

test('docsToMarkdown: bullet list', () => {
  const doc: DocsDocument = {
    lists: {
      L1: {
        listProperties: { nestingLevels: [{ glyphType: 'GLYPH_TYPE_UNSPECIFIED' }] },
      },
    },
    body: {
      content: [
        {
          paragraph: {
            bullet: { listId: 'L1', nestingLevel: 0 },
            elements: [{ textRun: { content: 'First\n' } }],
          },
        },
        {
          paragraph: {
            bullet: { listId: 'L1', nestingLevel: 0 },
            elements: [{ textRun: { content: 'Second\n' } }],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), '- First\n- Second')
})

test('docsToMarkdown: numbered list (DECIMAL glyph)', () => {
  const doc: DocsDocument = {
    lists: {
      L1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } },
    },
    body: {
      content: [
        {
          paragraph: {
            bullet: { listId: 'L1', nestingLevel: 0 },
            elements: [{ textRun: { content: 'One\n' } }],
          },
        },
        {
          paragraph: {
            bullet: { listId: 'L1', nestingLevel: 0 },
            elements: [{ textRun: { content: 'Two\n' } }],
          },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), '1. One\n1. Two')
})

test('docsToMarkdown: table placeholder', () => {
  const doc: DocsDocument = {
    body: {
      content: [
        {
          paragraph: { elements: [{ textRun: { content: 'Before\n' } }] },
        },
        { table: {} },
        {
          paragraph: { elements: [{ textRun: { content: 'After\n' } }] },
        },
      ],
    },
  }
  assert.equal(docsToMarkdown(doc), 'Before\n[table omitted]\nAfter')
})

// ---------------------------------------------------------------------------
// markdownToDocsRequests
// ---------------------------------------------------------------------------

test('markdownToDocsRequests: empty input', () => {
  assert.deepEqual(markdownToDocsRequests(''), [])
  assert.deepEqual(markdownToDocsRequests('   '), [])
})

test('markdownToDocsRequests: plain paragraph', () => {
  const reqs = markdownToDocsRequests('Hello world')
  // Expect: insertText('Hello world') at index 1, then insertText('\n').
  assert.ok(reqs.length >= 2)
  const first = reqs[0] as { insertText: { location: { index: number }; text: string } }
  assert.equal(first.insertText.location.index, 1)
  assert.equal(first.insertText.text, 'Hello world')
})

test('markdownToDocsRequests: heading produces updateParagraphStyle', () => {
  const reqs = markdownToDocsRequests('# My Heading')
  const hasHeadingStyle = reqs.some(
    r =>
      'updateParagraphStyle' in r &&
      r.updateParagraphStyle.paragraphStyle.namedStyleType === 'HEADING_1',
  )
  assert.ok(hasHeadingStyle, 'expected an updateParagraphStyle request with HEADING_1')
})

test('markdownToDocsRequests: bold produces updateTextStyle with bold', () => {
  const reqs = markdownToDocsRequests('This is **bold** text')
  const boldReq = reqs.find(
    r => 'updateTextStyle' in r && r.updateTextStyle.textStyle.bold === true,
  )
  assert.ok(boldReq, 'expected an updateTextStyle request with bold=true')
})

test('markdownToDocsRequests: link produces updateTextStyle with link', () => {
  const reqs = markdownToDocsRequests('See [Google](https://google.com).')
  const linkReq = reqs.find(
    r => 'updateTextStyle' in r && r.updateTextStyle.textStyle.link?.url === 'https://google.com',
  )
  assert.ok(linkReq, 'expected an updateTextStyle request with the link URL')
})

test('markdownToDocsRequests: bullet list produces createParagraphBullets', () => {
  const reqs = markdownToDocsRequests('- one\n- two\n- three')
  const bullets = reqs.find(r => 'createParagraphBullets' in r)
  assert.ok(bullets, 'expected a createParagraphBullets request for the bullet list')
})

test('markdownToDocsRequests: running cursor stays consistent across inserts', () => {
  const reqs = markdownToDocsRequests('# Heading\n\nParagraph')
  let cursor = 1
  for (const r of reqs) {
    if ('insertText' in r) {
      assert.equal(
        r.insertText.location.index,
        cursor,
        'insertText should target the current cursor position',
      )
      cursor += r.insertText.text.length
    }
  }
})
