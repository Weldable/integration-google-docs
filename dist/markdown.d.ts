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
type NamedStyleType = 'NORMAL_TEXT' | 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6';
interface TextStyle {
    bold?: boolean;
    italic?: boolean;
    link?: {
        url?: string;
    };
    weightedFontFamily?: {
        fontFamily?: string;
    };
}
interface TextRun {
    content?: string;
    textStyle?: TextStyle;
}
interface ParagraphElement {
    textRun?: TextRun;
    horizontalRule?: Record<string, unknown>;
}
interface DocsParagraph {
    elements?: ParagraphElement[];
    paragraphStyle?: {
        namedStyleType?: NamedStyleType;
    };
    bullet?: {
        listId?: string;
        nestingLevel?: number;
    };
}
interface DocsContentElement {
    paragraph?: DocsParagraph;
    table?: {
        tableRows?: Array<{
            tableCells?: Array<{
                content?: DocsContentElement[];
            }>;
        }>;
    };
    tableOfContents?: {
        content?: DocsContentElement[];
    };
    sectionBreak?: unknown;
}
interface Lists {
    [listId: string]: {
        listProperties?: {
            nestingLevels?: Array<{
                glyphType?: string;
                glyphSymbol?: string;
            }>;
        };
    };
}
export interface DocsDocument {
    title?: string;
    body?: {
        content?: DocsContentElement[];
    };
    lists?: Lists;
}
export declare function docsToMarkdown(doc: DocsDocument): string;
/**
 * Google Docs batchUpdate request type (narrow — only fields we emit).
 *
 * The Docs API uses 1-indexed character positions. A freshly-created blank
 * document has a single trailing newline at index 1, so the first
 * `insertText` request targets `location.index = 1`.
 */
type DocsRequest = {
    insertText: {
        location: {
            index: number;
        };
        text: string;
    };
} | {
    updateParagraphStyle: {
        range: {
            startIndex: number;
            endIndex: number;
        };
        paragraphStyle: {
            namedStyleType: NamedStyleType;
        };
        fields: string;
    };
} | {
    updateTextStyle: {
        range: {
            startIndex: number;
            endIndex: number;
        };
        textStyle: TextStyle;
        fields: string;
    };
} | {
    createParagraphBullets: {
        range: {
            startIndex: number;
            endIndex: number;
        };
        bulletPreset: string;
    };
};
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
export declare function markdownToDocsRequests(md: string): DocsRequest[];
export {};
//# sourceMappingURL=markdown.d.ts.map