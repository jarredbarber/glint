import { visit, SKIP, CONTINUE, EXIT } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node, Parent } from 'unist';
import type { VFile } from 'vfile';
import { widgets } from './widgets/index.js';

export function remarkGlintWidgets() {
    return (tree: Root, file: VFile) => {
        // Get content offset (for frontmatter stripping)
        const contentStartLine = (file.data.contentStartLine as number) || 1;
        const offset = contentStartLine - 1;

        visit(tree, (node: Node, index: number | undefined, parent: Parent | undefined) => {
            for (const handler of widgets) {
                if (handler.match(node)) {
                    // Pass offset to handler via node data
                    if (!node.data) node.data = {};
                    (node.data as any).sourceLineOffset = offset;

                    const result = handler.transform(node, index, parent);
                    if (result !== undefined) {
                        return result;
                    }
                }
            }
        });
    };
}

