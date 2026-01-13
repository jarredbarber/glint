export const renderHead = (title: string, theme: string, styles: string[] = []) => `
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/${theme}.css" id="theme-stylesheet">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n')}
    <script>

        // Apply user's preferred theme from localStorage (before first paint)
        (function() {
            var saved = localStorage.getItem('glint-theme');
            if (saved) {
                var link = document.getElementById('theme-stylesheet');
                if (link) link.href = '/assets/themes/' + saved + '.css';
            }
        })();
    </script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
`;
