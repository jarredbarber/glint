import { visit, SKIP, CONTINUE, EXIT } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node, Parent } from 'unist';
import { widgets } from './widgets/index.js';

export function remarkGlintWidgets() {
    return (tree: Root) => {
        visit(tree, (node: Node, index: number | undefined, parent: Parent | undefined) => {
            for (const handler of widgets) {
                if (handler.match(node)) {
                    const result = handler.transform(node, index, parent);
                    if (result !== undefined) {
                        return result;
                    }
                }
            }
        });
    };
}

