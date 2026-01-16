/**
 * Glint Cloudflare Workers Entry Point
 * 
 * This is the main entry point for deploying Glint as a Cloudflare Worker.
 * It uses Hono for routing and R2 for storage.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeRaw from 'rehype-raw';

import { R2StorageProvider, R2Bucket } from '../storage/r2.js';

// Worker environment bindings
interface Env {
    CONTENT_BUCKET: R2Bucket;
    GLINT_CONFIG?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for API endpoints
app.use('/api/*', cors());

// Health check
app.get('/health', (c) => {
    return c.json({ status: 'ok', runtime: 'cloudflare-workers' });
});

// Document API - Read markdown
app.get('/api/documents/*', async (c) => {
    const path = c.req.path.replace('/api/documents/', '');
    const render = c.req.query('render') === 'true';

    const storage = new R2StorageProvider('r2', c.env.CONTENT_BUCKET);

    try {
        const content = await storage.read(path);

        if (render) {
            // Simple markdown to HTML rendering
            const processor = unified()
                .use(remarkParse)
                .use(remarkGfm)
                .use(remarkRehype, { allowDangerousHtml: true })
                .use(rehypeRaw)
                .use(rehypeStringify);

            const result = await processor.process(content);
            return c.html(String(result));
        }

        return c.json({ content, path });
    } catch (err) {
        return c.json({ error: 'File not found', path }, 404);
    }
});

// Document API - List files
app.get('/api/files', async (c) => {
    const dir = c.req.query('dir') || '';
    const storage = new R2StorageProvider('r2', c.env.CONTENT_BUCKET);

    try {
        const files = await storage.list(dir);
        return c.json({ files });
    } catch (err) {
        return c.json({ error: 'Failed to list files' }, 500);
    }
});

// Catch-all for rendering markdown pages
app.get('/*', async (c) => {
    let path = c.req.path.slice(1); // Remove leading /

    // Default to README.md for root
    if (!path || path === '') {
        path = 'README.md';
    }

    // Add .md extension if not present
    if (!path.endsWith('.md')) {
        path = path + '.md';
    }

    const storage = new R2StorageProvider('r2', c.env.CONTENT_BUCKET);

    try {
        const content = await storage.read(path);

        // Simple markdown to HTML rendering
        const processor = unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkRehype, { allowDangerousHtml: true })
            .use(rehypeRaw)
            .use(rehypeStringify);

        const result = await processor.process(content);

        // Wrap in minimal HTML template
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glint</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            line-height: 1.6;
            color: #e0e0e0;
            background: #1e1e1e;
        }
        a { color: #6db3f2; }
        pre { background: #2d2d2d; padding: 1rem; overflow-x: auto; border-radius: 4px; }
        code { font-family: 'Fira Code', monospace; }
        img { max-width: 100%; }
    </style>
</head>
<body>
${String(result)}
</body>
</html>`;

        return c.html(html);
    } catch (err) {
        return c.html(`
<!DOCTYPE html>
<html>
<head><title>404 - Not Found</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 4rem;">
    <h1>404</h1>
    <p>File not found: ${path}</p>
    <a href="/">Go home</a>
</body>
</html>`, 404);
    }
});

export default app;
