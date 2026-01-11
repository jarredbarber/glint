import type { Node, Parent } from 'unist';
import type { VisitorResult } from 'unist-util-visit';

export interface WidgetHandler {
    /** Test if this handler should process the node */
    match: (node: Node) => boolean;
    /** Transform the node; return VisitorResult to control traversal */
    transform: (node: Node, index: number | undefined, parent: Parent | undefined) => VisitorResult | void;
}
