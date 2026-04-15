/**
 * Plain-text utilities for Google Docs edit.
 *
 * Google Docs' `replaceAllText` operates on the *plain text* of a document
 * (styled runs flattened, markdown syntax markers absent). To give edit a
 * Claude Code-style unique-match contract, we extract that same plain text
 * client-side and count occurrences before calling the API.
 */
/**
 * Flatten a Docs `body.content` array to the plain text Docs' own
 * `replaceAllText` sees — concatenation of every `textRun.content`, walked
 * in document order through paragraphs, tables, and TOCs.
 */
export function extractPlainText(content) {
    if (!content)
        return '';
    let out = '';
    for (const el of content) {
        if (el.paragraph?.elements) {
            for (const run of el.paragraph.elements) {
                if (run.textRun?.content)
                    out += run.textRun.content;
            }
        }
        else if (el.table?.tableRows) {
            for (const row of el.table.tableRows) {
                if (!row.tableCells)
                    continue;
                for (const cell of row.tableCells) {
                    out += extractPlainText(cell.content);
                }
            }
        }
        else if (el.tableOfContents?.content) {
            out += extractPlainText(el.tableOfContents.content);
        }
    }
    return out;
}
/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let i = 0;
    while (true) {
        const found = haystack.indexOf(needle, i);
        if (found === -1)
            break;
        count++;
        i = found + needle.length;
    }
    return count;
}
/**
 * Return up to `max` candidate match contexts with `pad` chars of surrounding
 * text on each side. Used to build the error message when `edit` finds more
 * than one match and needs the agent to pick a more unique anchor.
 */
export function findMatchContexts(haystack, needle, max, pad) {
    if (!needle)
        return [];
    const out = [];
    let i = 0;
    while (out.length < max) {
        const found = haystack.indexOf(needle, i);
        if (found === -1)
            break;
        const start = Math.max(0, found - pad);
        const end = Math.min(haystack.length, found + needle.length + pad);
        const prefix = start > 0 ? '...' : '';
        const suffix = end < haystack.length ? '...' : '';
        out.push(prefix + haystack.slice(start, end).replace(/\n/g, ' ') + suffix);
        i = found + needle.length;
    }
    return out;
}
