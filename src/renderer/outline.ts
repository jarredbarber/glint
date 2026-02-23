import { HeadingNode } from '../rehype-extract-headings.js';
import { escapeHtml } from '../utils/html.js';

export const renderRightOutline = (headings: HeadingNode[]) => {
    if (headings.length === 0) return '';

    const buildHierarchy = (headings: HeadingNode[]) => {
        const result: string[] = [];
        let i = 0;

        while (i < headings.length) {
            const heading = headings[i];
            const nextHeading = headings[i + 1];

            if (nextHeading && nextHeading.depth > heading.depth) {
                const children: HeadingNode[] = [];
                let j = i + 1;

                while (j < headings.length && headings[j].depth > heading.depth) {
                    children.push(headings[j]);
                    j++;
                }

                result.push(`
                    <li class="right-outline-item" data-depth="${heading.depth}">
                        <div class="right-outline-section" data-section-id="${escapeHtml(heading.id)}">
                            <div class="right-outline-section-header">
                                <span class="outline-toggle" data-section-id="${escapeHtml(heading.id)}" aria-label="Toggle section"></span>
                                <a href="#${escapeHtml(heading.id)}" class="right-outline-link" title="${escapeHtml(heading.text)}">${escapeHtml(heading.text)}</a>
                            </div>
                            <ul class="right-outline-section-children">
                                ${buildHierarchy(children)}
                            </ul>
                        </div>
                    </li>
                `);

                i = j;
            } else {
                result.push(`
                    <li class="right-outline-item" data-depth="${heading.depth}">
                        <a href="#${heading.id}" class="right-outline-link" title="${heading.text}">${heading.text}</a>
                    </li>
                `);
                i++;
            }
        }

        return result.join('');
    };

    return `
        <aside class="right-outline" aria-label="Table of contents">
            <div class="right-outline-header">On This Page</div>
            <ul class="right-outline-list">
                ${buildHierarchy(headings)}
            </ul>
        </aside>
    `;
};
