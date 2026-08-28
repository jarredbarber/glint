import { GlintConfig } from './config.js';
import { HeadingNode } from './rehype-extract-headings.js';
import { escapeHtml } from './utils/html.js';
import { renderHead } from './renderer/head.js';
import { renderMetadata } from './renderer/metadata.js';
import { renderRightOutline } from './renderer/outline.js';
import { contentBehaviorInit, contentBehaviorLoaders } from './renderer/content-behavior.js';

export interface RenderOptions {
    content: string;
    title: string;
    config: GlintConfig;
    currentPath: string;
    headings?: HeadingNode[];
    frontmatter?: Record<string, unknown>;
    styles?: string[];
}

export const renderHtml = (options: RenderOptions) => {
    const { content, title, config, currentPath, headings = [], frontmatter = {}, styles = [] } = options;
    const behaviorLoaders = contentBehaviorLoaders(content);

    return `
<!DOCTYPE html>
<html lang="en">
    ${renderHead(title, config.colorScheme, styles)}
    <body class="${config.colorScheme} shared-view" data-access="view" data-path="${escapeHtml(currentPath)}">
    <main class="content">
        <div class="content-wrapper">
            <header class="article-header">
                <h1>${escapeHtml(title)}</h1>
                ${renderMetadata(frontmatter)}
                <div class="title-accent"></div>
            </header>
            ${content}
        </div>
    </main>
    ${renderRightOutline(headings)}
    ${behaviorLoaders ? `${behaviorLoaders}\n${contentBehaviorInit()}` : ''}
</body>
</html>
`;
};
