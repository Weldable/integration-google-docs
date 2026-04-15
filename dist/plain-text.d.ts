/**
 * Plain-text utilities for Google Docs edit.
 *
 * Google Docs' `replaceAllText` operates on the *plain text* of a document
 * (styled runs flattened, markdown syntax markers absent). To give edit a
 * Claude Code-style unique-match contract, we extract that same plain text
 * client-side and count occurrences before calling the API.
 */
interface DocsContentElement {
    paragraph?: {
        elements?: Array<{
            textRun?: {
                content?: string;
            };
        }>;
    };
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
}
/**
 * Flatten a Docs `body.content` array to the plain text Docs' own
 * `replaceAllText` sees — concatenation of every `textRun.content`, walked
 * in document order through paragraphs, tables, and TOCs.
 */
export declare function extractPlainText(content: DocsContentElement[] | undefined): string;
/** Count non-overlapping occurrences of `needle` in `haystack`. */
export declare function countOccurrences(haystack: string, needle: string): number;
/**
 * Return up to `max` candidate match contexts with `pad` chars of surrounding
 * text on each side. Used to build the error message when `edit` finds more
 * than one match and needs the agent to pick a more unique anchor.
 */
export declare function findMatchContexts(haystack: string, needle: string, max: number, pad: number): string[];
export {};
//# sourceMappingURL=plain-text.d.ts.map