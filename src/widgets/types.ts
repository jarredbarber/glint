import type { Node, Parent } from 'unist';
import type { VisitorResult } from 'unist-util-visit';
import type { Text, Paragraph } from 'mdast';

export interface WidgetHandler {
    /** Test if this handler should process the node */
    match: (node: Node) => boolean;
    /** Transform the node; return VisitorResult to control traversal */
    transform: (node: Node, index: number | undefined, parent: Parent | undefined) => VisitorResult | void;
    getLLMInstructions?: () => string;
}

/**
 * HAST Element node structure for use in MDAST data.hChildren
 */
export interface HASTElement {
    type: 'element';
    tagName: string;
    properties?: Record<string, any>;
    children?: (HASTElement | HASTText)[];
}

/**
 * HAST Text node structure for use in MDAST data.hChildren
 */
export interface HASTText {
    type: 'text';
    value: string;
}

/**
 * Custom data properties for MDAST nodes that control rehype transformation.
 * Used by remark-rehype to override default HTML output.
 */
export interface CustomNodeData {
    hName?: string; // Override HTML tag name
    hProperties?: Record<string, any>; // HTML attributes
    hChildren?: (HASTElement | HASTText)[]; // Override children in HTML output
}

/**
 * MDAST Text node with custom data for HTML transformation
 */
export interface CustomTextNode extends Text {
    data?: CustomNodeData;
}

/**
 * MDAST Paragraph node with custom data for HTML transformation
 */
export interface CustomParagraphNode extends Paragraph {
    data?: CustomNodeData;
    children: Node[];
}
