import { escapeHtml } from '../utils/html.js';

export const renderHead = (title: string, colorScheme: string, styles: string[] = []) => `
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/assets/fonts.css">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/color-schemes/${colorScheme}.css" id="color-scheme-stylesheet">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n')}
</head>
`;
