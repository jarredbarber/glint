import { escapeHtml } from '../utils/html.js';
import { MERMAID_CDN } from './content-behavior.js';

export const renderHead = (title: string, colorScheme: string, styles: string[] = []) => `
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https: 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data: blob:; media-src https: blob:; font-src 'self' https: data:; connect-src https:; frame-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'none'">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/color-schemes/${colorScheme}.css" id="color-scheme-stylesheet">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n')}
    <script src="${MERMAID_CDN}"></script>
</head>
`;
