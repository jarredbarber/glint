import { escapeHtml } from '../utils/html.js';

// Format in UTC: YAML parses `date: 2026-09-01` to UTC midnight, so a local
// toLocaleDateString in a negative-offset zone rolled it back a day (#167).
// Keep the calendar date the author wrote (and mtime instants consistent with it).
const DATE_FMT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };

export const formatDate = (rawDate: unknown): string | null => {
    if (!rawDate) return null;
    if (rawDate instanceof Date) {
        return rawDate.toLocaleDateString('en-US', DATE_FMT);
    } else if (typeof rawDate === 'string') {
        const parsed = new Date(rawDate);
        return isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString('en-US', DATE_FMT);
    }
    return String(rawDate);
};

export const renderMetadata = (frontmatter: Record<string, unknown>) => {
    const date = formatDate(frontmatter.date);
    const updated = formatDate(frontmatter.updated || frontmatter.modified);
    const author = frontmatter.author as string | undefined;
    const category = frontmatter.category as string | undefined;
    const tags = frontmatter.tags as string[] | string | undefined;
    const description = (frontmatter.description || frontmatter.summary) as string | undefined;
    const readingTime = frontmatter['reading-time'] as string | undefined;
    const image = (frontmatter.image || frontmatter.thumbnail) as string | undefined;
    const isDraft = frontmatter.draft === true;

    const hasAnyMeta = date || author || updated || category || tags || description || readingTime || isDraft;
    if (!hasAnyMeta && !image) return '';

    let html = '';

    // Featured image
    if (image) {
        html += `<img class="featured-image" src="${escapeHtml(image)}" alt="Featured image">`;
    }

    // Draft indicator
    if (isDraft) {
        html += `<div class="draft-badge">📝 Draft</div>`;
    }

    // Primary meta line (date, author, category, reading time)
    const metaParts = [];
    if (date) metaParts.push(`<span class="meta-date">${escapeHtml(date)}</span>`);
    if (updated && updated !== date) metaParts.push(`<span class="meta-updated">Updated ${escapeHtml(updated)}</span>`);
    if (author) metaParts.push(`<span class="meta-author">by ${escapeHtml(author)}</span>`);
    if (category) metaParts.push(`<span class="meta-category">${escapeHtml(category)}</span>`);
    if (readingTime) metaParts.push(`<span class="meta-reading-time">${escapeHtml(readingTime)}</span>`);

    if (metaParts.length > 0) {
        html += `<div class="article-meta">${metaParts.join(' · ')}</div>`;
    }

    // Tags as pills
    if (tags) {
        const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        const tagHtml = tagList.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
        html += `<div class="article-tags">${tagHtml}</div>`;
    }

    // Description/summary
    if (description) {
        html += `<p class="article-description">${escapeHtml(description)}</p>`;
    }

    return html;
};
