import { defineIntegration, IntegrationValidationError, fakeId } from '@weldable/integration-core';
import { docsToMarkdown, markdownToDocsRequests } from './markdown.js';
import { extractPlainText, countOccurrences, findMatchContexts } from './plain-text.js';
export default defineIntegration({
    id: 'google_docs',
    name: 'Google Docs',
    description: 'Read, create, and edit Google Docs documents as markdown.',
    icon: 'docs',
    version: 2,
    baseUrl: 'https://docs.googleapis.com/v1/documents',
    auth: {
        type: 'oauth2',
        test: async (_, ctx) => ctx.http.get('https://www.googleapis.com/oauth2/v1/userinfo').then(r => r.data),
    },
    nangoScopes: 'openid,email,https://www.googleapis.com/auth/documents',
    nangoCredentialEnvPrefix: 'GOOGLE',
    exampleUsage: "Create a meeting notes doc for tomorrow's product review",
    actions: [
        {
            actionId: 'read',
            name: 'Read document',
            description: "Read a Google Doc as markdown. Returns line-numbered output in cat -n style (' 1→# Heading'). The ' N→' prefix is display-only; edit matches against the raw markdown. If endLine < totalLines, paginate with { offset: endLine + 1 }. Default limit is 2000 lines.",
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
                {
                    name: 'offset',
                    type: 'number',
                    required: false,
                    description: 'Line number to start reading from (1-indexed). Default 1.',
                },
                {
                    name: 'limit',
                    type: 'number',
                    required: false,
                    description: 'Maximum number of lines to return. Default 2000.',
                },
            ],
            outputFields: [
                { name: 'title', type: 'string', description: 'Title of the document.' },
                { name: 'markdown', type: 'string', description: "Line-numbered markdown slice of the document (cat -n style: ' 1→...'). The prefix is display-only." },
                { name: 'startLine', type: 'number', description: 'First line number included in this slice (1-indexed).' },
                { name: 'endLine', type: 'number', description: 'Last line number included in this slice (1-indexed).' },
                { name: 'totalLines', type: 'number', description: 'Total number of lines in the document. Paginate with offset: endLine + 1 if endLine < totalLines.' },
            ],
            mockExecute: async (_args, _ctx) => ({
                title: 'Mock Document',
                markdown: '    1→# Mock Document\n    2→\n    3→This is mock content for workflow authoring.',
                startLine: 1,
                endLine: 3,
                totalLines: 3,
            }),
            execute: async (args, ctx) => {
                const documentId = requireString(args, 'documentId');
                const offset = optionalPositiveInt(args.offset, 1);
                const limit = optionalPositiveInt(args.limit, 2000);
                const res = await ctx.http.get(`/${encodeURIComponent(documentId)}`);
                const doc = res.data;
                const md = docsToMarkdown(doc);
                const lines = md.split('\n');
                const totalLines = lines.length;
                const start = Math.min(Math.max(1, offset), Math.max(1, totalLines));
                const end = Math.min(totalLines, start + limit - 1);
                const slice = lines.slice(start - 1, end);
                const numbered = slice
                    .map((line, i) => `${String(start + i).padStart(5, ' ')}→${line}`)
                    .join('\n');
                return {
                    title: doc.title ?? '',
                    markdown: numbered,
                    startLine: start,
                    endLine: end,
                    totalLines,
                };
            },
        },
        {
            actionId: 'create',
            name: 'Create document',
            description: "Create a new Google Doc. Pass the body as markdown in the `content` field — it will be rendered with real Docs formatting (headings, bold, italic, inline code, links, bullet/numbered lists, horizontal rules). Tables and images are not supported in v1 and will render as plain text.",
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
                {
                    name: 'content',
                    type: 'text',
                    required: false,
                    description: 'Document body as markdown. Supported: headings (# through ######), paragraphs, bold, italic, inline code, links, bullet/numbered lists, horizontal rules. Tables and images render as plain text.',
                },
            ],
            outputFields: [
                { name: 'documentId', type: 'string', description: 'Unique ID of the newly created document.' },
                { name: 'title', type: 'string', description: 'Title of the created document.' },
                { name: 'url', type: 'string', description: 'Shareable web URL of the document.' },
            ],
            mockExecute: async (args, ctx) => {
                const documentId = fakeId(ctx.seed, 44);
                const title = String(args.title ?? 'Mock Document');
                return { documentId, title, url: `https://docs.google.com/document/d/${documentId}/edit` };
            },
            execute: async (args, ctx) => {
                const title = requireString(args, 'title');
                const content = typeof args.content === 'string' ? args.content : '';
                const created = await ctx.http.post('/', { title });
                const createdData = created.data;
                const documentId = createdData.documentId;
                if (!documentId) {
                    throw new Error('google_docs.create: Docs API returned no documentId');
                }
                if (content.trim()) {
                    const requests = markdownToDocsRequests(content);
                    if (requests.length > 0) {
                        await ctx.http.post(`/${encodeURIComponent(documentId)}:batchUpdate`, { requests });
                    }
                }
                return {
                    documentId,
                    title,
                    url: `https://docs.google.com/document/d/${documentId}/edit`,
                };
            },
        },
        {
            actionId: 'edit',
            name: 'Edit document',
            description: "Replace text in a Google Doc. Matches against the document's plain text — oldText must appear exactly once or the edit fails with match context. Text-only edits work perfectly (typos, word substitution). Formatting changes (inserting headings, bullets, bold) do NOT work via edit: if newText contains markdown syntax like ** or #, those characters become literal text in the doc. To change formatting, use create to make a new doc with the updated markdown.",
            intents: [
                'change text in a doc',
                'fix a typo in the document',
                'replace text in my google doc',
                'update wording in the doc',
                'swap a word in the document',
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
                    name: 'oldText',
                    type: 'text',
                    required: true,
                    description: "Exact text to find in the document's plain text. Must match exactly once. Case-sensitive. If there are multiple matches, include more surrounding context to make it unique.",
                },
                {
                    name: 'newText',
                    type: 'text',
                    required: true,
                    description: 'Replacement text. Inserted as plain text — markdown syntax is not rendered.',
                },
            ],
            outputFields: [
                { name: 'replaced', type: 'boolean', description: 'True if the replacement succeeded.' },
            ],
            execute: async (args, ctx) => {
                const documentId = requireString(args, 'documentId');
                const oldText = requireString(args, 'oldText');
                const newText = typeof args.newText === 'string' ? args.newText : '';
                const res = await ctx.http.get(`/${encodeURIComponent(documentId)}`);
                const doc = res.data;
                const plainText = extractPlainText(doc.body?.content);
                const count = countOccurrences(plainText, oldText);
                if (count === 0) {
                    throw new IntegrationValidationError('edit failed: no match for oldText in document. Read the document first to find the exact text.', 'oldText');
                }
                if (count > 1) {
                    const candidates = findMatchContexts(plainText, oldText, 3, 80);
                    throw new IntegrationValidationError(`edit failed: oldText matched ${count} locations. Narrow the anchor with more surrounding context. Top candidates:\n` +
                        candidates.map((c, i) => `[${i + 1}] ${c}`).join('\n---\n'), 'oldText');
                }
                await ctx.http.post(`/${encodeURIComponent(documentId)}:batchUpdate`, {
                    requests: [
                        {
                            replaceAllText: {
                                containsText: { text: oldText, matchCase: true },
                                replaceText: newText,
                            },
                        },
                    ],
                });
                return { replaced: true };
            },
        },
    ],
});
// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------
function requireString(args, field) {
    const v = args[field];
    if (typeof v !== 'string' || !v) {
        throw new IntegrationValidationError(`"${field}" is required and must be a string`, field);
    }
    return v;
}
function optionalPositiveInt(v, defaultValue) {
    if (v === undefined || v === null || v === '')
        return defaultValue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0)
        return defaultValue;
    return Math.floor(n);
}
