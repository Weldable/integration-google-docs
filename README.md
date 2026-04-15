# @weldable/integration-google-docs

Google Docs read and write actions for Weldable.

Part of the [Weldable](https://weldable.ai/) integration library — see [@weldable/integration-core](https://github.com/weldable/integration-core) for the full catalog.

## Install

```bash
npm install @weldable/integration-google-docs @weldable/integration-core
```

`@weldable/integration-core` is a peer dependency and must be installed alongside this package.

## Usage

```ts
import integration from '@weldable/integration-google-docs'

// Read a document (returns line-numbered markdown)
const read = integration.actions.find(a => a.id === 'google_docs.read')!

const doc = await read.execute(
  { documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' },
  ctx, // ActionContext from your Weldable-compatible host
)

console.log(doc.content) // line-numbered markdown of the document

// Edit a document (unique-match contract: fails if oldText appears 0 or 2+ times)
const edit = integration.actions.find(a => a.id === 'google_docs.edit')!

await edit.execute(
  {
    documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
    oldText: 'Q1 targets are pending review.',
    newText: 'Q1 targets have been approved.',
  },
  ctx,
)

// Create a document from markdown
const create = integration.actions.find(a => a.id === 'google_docs.create')!

const result = await create.execute(
  {
    title: 'Release notes v1.1',
    content: '## What\'s new\n\n- Improved error messages\n- Faster search',
  },
  ctx,
)

console.log(result.documentId)
