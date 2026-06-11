import type { Node, Parent } from 'unist';
import type { VisitorResult } from 'unist-util-visit';
import type { Text, Paragraph } from 'mdast';
import type { Element as HASTElement, Text as HASTText, ElementContent } from 'hast';

export interface WidgetHandler {
    /** Test if this handler should process the node */
    match: (node: Node) => boolean;
    /** Transform the node; return VisitorResult to control traversal */
    transform: (node: Node, index: number | undefined, parent: Parent | undefined) => VisitorResult | void;
    getLLMInstructions?: () => string;
}

/**
 * Re-export the relevant HAST node types so widget code has a single import
 * point. These are the real `hast` types, which is what `remark-rehype`
 * (via `mdast-util-to-hast`) expects inside `data.hChildren`.
 */
export type { HASTElement, HASTText };

/**
 * Custom data properties for MDAST nodes that control rehype transformation.
 *
 * `remark-rehype` (`mdast-util-to-hast`) already augments the mdast `Data`
 * interface with exactly these fields, so this mirrors that contract:
 * `hChildren` is a list of real HAST `ElementContent`, and `hProperties`
 * is a HAST `Properties` map. Keeping these aligned with the upstream types
 * is what makes the custom nodes assignable to the base mdast node types.
 */
export interface CustomNodeData {
    hName?: string; // Override HTML tag name
    hProperties?: Record<string, any>; // HTML attributes
    hChildren?: ElementContent[]; // Override children in HTML output
}

/**
 * MDAST Text node with custom data for HTML transformation.
 *
 * `mdast`'s `Text` already carries the augmented `Data` (with optional
 * `hName`/`hProperties`/`hChildren`), so we only need the base type here.
 */
export type CustomTextNode = Text;

/**
 * MDAST wrapper node used to emit arbitrary block-level HTML structure.
 *
 * These wrappers are typed as `paragraph` so `remark-rehype` runs its default
 * block handling, but `data.hName` overrides the rendered tag (e.g. `div`).
 * Their `children` hold arbitrary mdast content (other wrappers, phrasing
 * content, text nodes), which does not fit `Paragraph`'s `PhrasingContent[]`,
 * so we override `children` to the broader mdast `Node` list. We omit
 * `Paragraph`'s `children` to avoid the incompatible-override error.
 */
export interface CustomParagraphNode extends Omit<Paragraph, 'children'> {
    children: Node[];
}
