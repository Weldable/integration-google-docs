import { defineIntegration, createRestHandler } from '@weldable/integration-core'

const rest = createRestHandler()

export default defineIntegration({
  id: 'google_docs',
  name: 'Google Docs',
  description: 'Create, read, and edit Google Docs documents.',
  icon: 'docs',
  version: 1,
  baseUrl: 'https://docs.googleapis.com/v1/documents',
  auth: {
    type: 'oauth2',
    test: async (_, ctx) => ctx.http.get('https://www.googleapis.com/oauth2/v1/userinfo').then(r => r.data as Record<string, unknown>),
  },
  nangoScopes: 'openid,email,https://www.googleapis.com/auth/documents',
  nangoCredentialEnvPrefix: 'GOOGLE',
  exampleUsage: "Create a meeting notes doc for tomorrow's product review",
  actions: [
    {
      actionId: 'get',
      name: 'Read document',
      description: 'Read the full content of a Google Doc.',
      intents: [
        'read my google doc',
        'open this document',
        'get the contents of a doc',
        'show me what is in this doc',
        'fetch document text',
        'pull up my document',
        'retrieve a google doc',
      ],
      preview: '{documentId}',
      inputFields: [
        {
          name: 'documentId',
          type: 'string',
          required: true,
          description: 'The ID of the document to read (from the Google Docs URL).',
        },
      ],
      outputFields: [
        { name: 'documentId', type: 'string', description: 'Unique ID of the document (use in other Google Docs actions).' },
        { name: 'title', type: 'string', description: 'Title of the document.' },
        { name: 'body', type: 'object', description: 'Document body containing the content elements array.' },
        { name: 'revisionId', type: 'string', description: 'Current revision ID of the document.' },
      ],
      execute: rest({
        method: 'GET',
        path: '/{documentId}',
        paramMapping: { documentId: 'path' },
      }),
    },
    {
      actionId: 'create',
      name: 'Create document',
      description: 'Create a new blank Google Doc with a title.',
      intents: [
        'make a new google doc',
        'start a new document',
        'create a doc called',
        'write a new document',
        'open a blank doc',
        'set up a meeting notes doc',
        'make a document for',
        'new google doc',
      ],
      preview: '{title}',
      inputFields: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: 'The title of the new document.',
        },
      ],
      outputFields: [
        { name: 'documentId', type: 'string', description: 'Unique ID of the newly created document.' },
        { name: 'title', type: 'string', description: 'Title of the created document.' },
        { name: 'revisionId', type: 'string', description: 'Initial revision ID of the document.' },
      ],
      execute: rest({
        method: 'POST',
        path: '/',
        paramMapping: { title: 'body' },
      }),
    },
    {
      actionId: 'batch_update',
      name: 'Edit document',
      description: 'Edit a document\'s content — insert text, replace text, delete content, update formatting, add tables, and more.',
      intents: [
        'add text to the doc',
        'write to a google doc',
        'update document content',
        'insert text into a doc',
        'replace text in the document',
        'edit a google doc',
        'append to my document',
        'format the document',
        'modify the doc',
        'change text in a document',
      ],
      preview: '{documentId}',
      inputFields: [
        {
          name: 'documentId',
          type: 'string',
          required: true,
          description: 'The ID of the document to edit.',
        },
        {
          name: 'requests',
          type: 'object',
          required: true,
          description: 'Array of edit operations. Supported types: insertText (add text at a position), replaceAllText (find and replace), deleteContentRange (remove a range), insertTable, updateTextStyle, updateParagraphStyle. Full list of request types: https://developers.google.com/docs/api/reference/rest/v1/documents/request#Request',
        },
      ],
      outputFields: [
        { name: 'documentId', type: 'string', description: 'ID of the document that was updated.' },
        { name: 'replies', type: 'array', description: 'Array of reply objects corresponding to each request, containing results of operations like insertedInlineObject or createNamedRangeResponse.' },
        { name: 'writeControl', type: 'object', description: 'Write control response with the requiredRevisionId that was applied.' },
      ],
      execute: rest({
        method: 'POST',
        path: '/{documentId}:batchUpdate',
        paramMapping: { documentId: 'path', requests: 'body' },
      }),
    },
  ],
})
