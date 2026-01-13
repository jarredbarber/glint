export const renderBreadcrumbs = (currentPath: string) => {
    // Clean path
    const path = currentPath.startsWith('/') ? currentPath.slice(1) : currentPath;
    if (!path || path === '/' || path === 'index.md') return '';

    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return '';

    let html = `
        <nav class="breadcrumbs" aria-label="Breadcrumb">
            <ol>
                <li><a href="/" class="breadcrumb-home">🏠 Home</a></li>
    `;

    let currentUrl = '';

    // Process all segments except the last one (which is the current page)
    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        currentUrl += '/' + segment;

        // Capitalize first letter
        const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

        html += `
            <li class="breadcrumb-separator">/</li>
            <li><a href="${currentUrl}">${label}</a></li>
        `;
    }

    // Add current page (last segment)
    const lastSegment = segments[segments.length - 1];
    // Strip .md extension for display if present
    const label = lastSegment.replace(/\.md$/, '').charAt(0).toUpperCase() + lastSegment.replace(/\.md$/, '').slice(1).replace(/-/g, ' ');

    html += `
            <li class="breadcrumb-separator">/</li>
            <li class="breadcrumb-current" aria-current="page">${label}</li>
        </ol>
    </nav>
    `;

    return html;
};
