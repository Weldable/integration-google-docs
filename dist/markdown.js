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
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
// ---------------------------------------------------------------------------
// Docs → markdown
// ---------------------------------------------------------------------------
const HEADING_PREFIX = {
    TITLE: '# ',
    HEADING_1: '# ',
    HEADING_2: '## ',
    HEADING_3: '### ',
    HEADING_4: '#### ',
    HEADING_5: '##### ',
    HEADING_6: '###### ',
};
export function docsToMarkdown(doc) {
    const content = doc.body?.content ?? [];
    const lists = doc.lists ?? {};
    const lines = [];
    for (const el of content) {
        if (el.paragraph) {
            const line = renderParagraph(el.paragraph, lists);
            lines.push(line);
            continue;
        }
        if (el.table) {
            lines.push('[table omitted]');
            continue;
        }
        if (el.tableOfContents) {
            lines.push('[table of contents omitted]');
            continue;
        }
        if (el.sectionBreak) {
            // Section breaks render as blank separators.
            if (lines.length > 0 && lines[lines.length - 1] !== '')
                lines.push('');
        }
    }
    // Collapse runs of 3+ blank lines to 2, and trim trailing blanks.
    const collapsed = [];
    for (const line of lines) {
        if (line === '' && collapsed.length > 0 && collapsed[collapsed.length - 1] === '') {
            continue;
        }
        collapsed.push(line);
    }
    while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '')
        collapsed.pop();
    return collapsed.join('\n');
}
function renderParagraph(p, lists) {
    const elements = p.elements ?? [];
    // Horizontal rule paragraph: single element with horizontalRule.
    if (elements.length === 1 && elements[0].horizontalRule) {
        return '---';
    }
    // Collect text runs into marked-up inline markdown.
    const inline = renderInlineRuns(elements);
    // List item? (Docs uses `bullet` to mark list membership.)
    if (p.bullet) {
        const listId = p.bullet.listId ?? '';
        const level = p.bullet.nestingLevel ?? 0;
        const indent = '  '.repeat(Math.max(0, level));
        const glyph = lists[listId]?.listProperties?.nestingLevels?.[level]?.glyphType;
        // Google marks ordered lists with DECIMAL / DECIMAL_ALPHA_ROMAN / etc;
        // unordered with GLYPH_TYPE_UNSPECIFIED or falsy.
        const ordered = typeof glyph === 'string' && /DECIMAL|ALPHA|ROMAN/i.test(glyph);
        const marker = ordered ? '1. ' : '- ';
        return `${indent}${marker}${inline.trim()}`;
    }
    const prefix = HEADING_PREFIX[p.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'] ?? '';
    return `${prefix}${inline.trim()}`;
}
function renderInlineRuns(elements) {
    let out = '';
    for (const el of elements) {
        const run = el.textRun;
        if (!run)
            continue;
        let text = run.content ?? '';
        if (!text)
            continue;
        // Trailing newline on a paragraph's final run is structural — strip it;
        // the caller re-joins paragraphs with '\n'.
        text = text.replace(/\n$/, '');
        if (!text)
            continue;
        const style = run.textStyle ?? {};
        const isCode = /mono/i.test(style.weightedFontFamily?.fontFamily ?? '');
        let wrapped = escapeMarkdown(text);
        if (isCode)
            wrapped = `\`${text.replace(/`/g, '\\`')}\``;
        if (style.bold)
            wrapped = `**${wrapped}**`;
        if (style.italic)
            wrapped = `*${wrapped}*`;
        if (style.link?.url)
            wrapped = `[${wrapped}](${style.link.url})`;
        out += wrapped;
    }
    return out;
}
function escapeMarkdown(s) {
    // Minimal escaping: only characters that would break round-trip rendering
    // at paragraph start. We deliberately avoid aggressive escaping so the
    // output stays readable for agents.
    return s.replace(/([\\`*_])/g, '\\$1');
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
export function markdownToDocsRequests(md) {
    if (!md.trim())
        return [];
    const tree = fromMarkdown(md, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
    });
    const requests = [];
    const state = { cursor: 1 };
    for (const node of tree.children) {
        emitBlock(node, requests, state);
    }
    return requests;
}
function emitBlock(node, reqs, state) {
    switch (node.type) {
        case 'heading':
            emitHeading(node, reqs, state);
            return;
        case 'paragraph':
            emitParagraph(node, reqs, state);
            return;
        case 'list':
            emitList(node, reqs, state);
            return;
        case 'thematicBreak':
            // A thematic break is a standalone paragraph in Docs. Emit a newline.
            insertText(reqs, state, '\n');
            return;
        case 'code': {
            // Fenced code block → monospace paragraph(s).
            const text = (node.value ?? '') + '\n';
            const start = state.cursor;
            insertText(reqs, state, text);
            reqs.push({
                updateTextStyle: {
                    range: { startIndex: start, endIndex: state.cursor - 1 },
                    textStyle: { weightedFontFamily: { fontFamily: 'Roboto Mono' } },
                    fields: 'weightedFontFamily',
                },
            });
            return;
        }
        case 'blockquote': {
            // Render children as plain paragraphs — Docs' quote styling is
            // non-trivial and not worth the complexity in v1.
            for (const child of node.children)
                emitBlock(child, reqs, state);
            return;
        }
        default:
            // Unsupported block types (table, html, etc.) → flatten to text.
            const flat = flattenToText(node);
            if (flat)
                insertText(reqs, state, flat + '\n');
            return;
    }
}
function emitHeading(node, reqs, state) {
    const start = state.cursor;
    renderPhrasing(node.children, reqs, state);
    insertText(reqs, state, '\n');
    const level = Math.min(6, Math.max(1, node.depth));
    reqs.push({
        updateParagraphStyle: {
            range: { startIndex: start, endIndex: state.cursor - 1 },
            paragraphStyle: { namedStyleType: `HEADING_${level}` },
            fields: 'namedStyleType',
        },
    });
}
function emitParagraph(node, reqs, state) {
    renderPhrasing(node.children, reqs, state);
    insertText(reqs, state, '\n');
}
function emitList(node, reqs, state) {
    const start = state.cursor;
    for (const item of node.children) {
        // Each list item: emit its paragraph children, but as a single line
        // per item (we don't support multi-paragraph list items in v1).
        for (const child of item.children) {
            if (child.type === 'paragraph') {
                renderPhrasing(child.children, reqs, state);
            }
            else {
                // Nested list or other block inside a list item → flatten.
                const flat = flattenToText(child);
                if (flat)
                    insertText(reqs, state, flat);
            }
        }
        insertText(reqs, state, '\n');
    }
    const end = state.cursor - 1;
    if (end > start) {
        reqs.push({
            createParagraphBullets: {
                range: { startIndex: start, endIndex: end },
                bulletPreset: node.ordered
                    ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
                    : 'BULLET_DISC_CIRCLE_SQUARE',
            },
        });
    }
}
/**
 * Emit inserts + updateTextStyle requests for a run of phrasing content.
 * Returns the concatenated plain text (useful for callers that need
 * character counts, though they can also diff `state.cursor`).
 */
function renderPhrasing(nodes, reqs, state) {
    let accumulated = '';
    for (const node of nodes) {
        accumulated += emitInline(node, reqs, state, {});
    }
    return accumulated;
}
function emitInline(node, reqs, state, style) {
    switch (node.type) {
        case 'text': {
            const text = node.value;
            if (!text)
                return '';
            const start = state.cursor;
            insertText(reqs, state, text);
            applyInlineStyle(reqs, start, state.cursor, style);
            return text;
        }
        case 'strong': {
            let out = '';
            for (const child of node.children) {
                out += emitInline(child, reqs, state, { ...style, bold: true });
            }
            return out;
        }
        case 'emphasis': {
            let out = '';
            for (const child of node.children) {
                out += emitInline(child, reqs, state, { ...style, italic: true });
            }
            return out;
        }
        case 'inlineCode': {
            const text = node.value;
            if (!text)
                return '';
            const start = state.cursor;
            insertText(reqs, state, text);
            applyInlineStyle(reqs, start, state.cursor, { ...style, code: true });
            return text;
        }
        case 'link': {
            const link = node;
            let out = '';
            for (const child of link.children) {
                out += emitInline(child, reqs, state, { ...style, linkUrl: link.url });
            }
            return out;
        }
        case 'break': {
            // Soft line break → literal newline inside the paragraph. Docs
            // treats this as a new paragraph, which is the closest equivalent.
            void node;
            insertText(reqs, state, '\n');
            return '\n';
        }
        default: {
            // Images, html, footnoteReference — flatten to text if possible.
            const flat = flattenToText(node);
            if (flat) {
                const start = state.cursor;
                insertText(reqs, state, flat);
                applyInlineStyle(reqs, start, state.cursor, style);
                return flat;
            }
            return '';
        }
    }
}
function applyInlineStyle(reqs, startIndex, cursorAfter, style) {
    const endIndex = cursorAfter;
    if (endIndex <= startIndex)
        return;
    const textStyle = {};
    const fields = [];
    if (style.bold) {
        textStyle.bold = true;
        fields.push('bold');
    }
    if (style.italic) {
        textStyle.italic = true;
        fields.push('italic');
    }
    if (style.code) {
        textStyle.weightedFontFamily = { fontFamily: 'Roboto Mono' };
        fields.push('weightedFontFamily');
    }
    if (style.linkUrl) {
        textStyle.link = { url: style.linkUrl };
        fields.push('link');
    }
    if (fields.length === 0)
        return;
    reqs.push({
        updateTextStyle: {
            range: { startIndex, endIndex },
            textStyle,
            fields: fields.join(','),
        },
    });
}
function insertText(reqs, state, text) {
    if (!text)
        return;
    reqs.push({
        insertText: { location: { index: state.cursor }, text },
    });
    state.cursor += text.length;
}
function flattenToText(node) {
    if (typeof node.value === 'string')
        return node.value;
    if (!Array.isArray(node.children))
        return '';
    let out = '';
    for (const child of node.children) {
        out += flattenToText(child);
    }
    return out;
}
