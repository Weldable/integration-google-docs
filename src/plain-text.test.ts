/**
 * Unit tests for plain-text.ts. Run with `npx tsx --test src/plain-text.test.ts`
 * from the integration-google-docs package root.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPlainText, countOccurrences, findMatchContexts } from './plain-text'

test('extractPlainText: simple paragraph', () => {
  const content = [
    {
      paragraph: {
        elements: [
          { textRun: { content: 'Hello ' } },
          { textRun: { content: 'world\n' } },
        ],
      },
    },
  ]
  assert.equal(extractPlainText(content), 'Hello world\n')
})

test('extractPlainText: multiple paragraphs', () => {
  const content = [
    { paragraph: { elements: [{ textRun: { content: 'First\n' } }] } },
    { paragraph: { elements: [{ textRun: { content: 'Second\n' } }] } },
  ]
  assert.equal(extractPlainText(content), 'First\nSecond\n')
})

test('extractPlainText: walks into tables', () => {
  const content = [
    {
      table: {
        tableRows: [
          {
            tableCells: [
              {
                content: [
                  { paragraph: { elements: [{ textRun: { content: 'cell\n' } }] } },
                ],
              },
            ],
          },
        ],
      },
    },
  ]
  assert.equal(extractPlainText(content), 'cell\n')
})

test('extractPlainText: empty content', () => {
  assert.equal(extractPlainText([]), '')
  assert.equal(extractPlainText(undefined), '')
})

test('countOccurrences: basics', () => {
  assert.equal(countOccurrences('hello world', 'hello'), 1)
  assert.equal(countOccurrences('abcabc', 'abc'), 2)
  assert.equal(countOccurrences('aaaa', 'aa'), 2) // non-overlapping
  assert.equal(countOccurrences('nothing', 'missing'), 0)
  assert.equal(countOccurrences('anything', ''), 0)
})

test('findMatchContexts: returns padded contexts', () => {
  const text = 'start here and also here for sure'
  const contexts = findMatchContexts(text, 'here', 3, 5)
  assert.equal(contexts.length, 2)
  assert.ok(contexts[0].includes('here'))
  assert.ok(contexts[1].includes('here'))
})

test('findMatchContexts: max limit honored', () => {
  const text = 'a a a a a a a a a a'
  const contexts = findMatchContexts(text, 'a', 3, 2)
  assert.equal(contexts.length, 3)
})

test('findMatchContexts: collapses newlines in context', () => {
  const text = 'before\nmatch\nafter'
  const [ctx] = findMatchContexts(text, 'match', 1, 10)
  assert.ok(!ctx.includes('\n'))
})
