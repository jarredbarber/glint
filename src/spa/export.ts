// Portable, static document export for the SPA. Content is already rendered by GlintRender.
const EXPORT_CSS = `
:root { color-scheme: light; font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif; color: #202733; background: #f7f8fa; }
* { box-sizing: border-box; }
body { max-width: 48rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; line-height: 1.65; }
h1, h2, h3, h4, h5, h6 { color: #17202d; line-height: 1.18; margin: 2rem 0 .75rem; }
h1 { font-size: 2.4rem; margin-top: 0; } h2 { font-size: 1.7rem; } h3 { font-size: 1.3rem; }
a { color: #245c8f; } p, ul, ol, blockquote, pre, table { margin: 0 0 1rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
pre { overflow-x: auto; padding: 1rem; border: 1px solid #d8dee8; background: #eef1f5; border-radius: .25rem; }
pre code { font-size: .85rem; } blockquote { padding-left: 1rem; border-left: .25rem solid #9eb8cf; color: #4d5b6a; }
table { width: 100%; border-collapse: collapse; } th, td { padding: .45rem .6rem; border: 1px solid #d8dee8; text-align: left; }
img { max-width: 100%; height: auto; } hr { border: 0; border-top: 1px solid #d8dee8; margin: 2rem 0; }
`;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]!));
}

export function createStandaloneHtml(title: string, content: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
${content}
</body>
</html>
`;
}
