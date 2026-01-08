import fastifyFactory from 'fastify';
const fastify = fastifyFactory({ logger: true });
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import fastifyStatic from '@fastify/static';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTENT_DIR = path.join(__dirname, 'content');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Initialize the markdown processor
const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeStringify);

fastify.register(fastifyStatic, {
    root: ASSETS_DIR,
    prefix: '/assets/',
});

const renderHtml = (content, title) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/default.css">
</head>
<body data-theme="light">
    <main>
        ${content}
    </main>
</body>
</html>
`;

fastify.get('/*', async (request, reply) => {
    const urlPath = request.params['*'] || '';
    let fullPath = path.resolve(CONTENT_DIR, urlPath);

    // Security: Prevent directory traversal
    if (!fullPath.startsWith(CONTENT_DIR)) {
        return reply.code(403).send('Forbidden');
    }

    try {
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            fullPath = path.join(fullPath, 'index.md');
        } else if (!fullPath.endsWith('.md')) {
            fullPath += '.md';
        }

        const mdContent = await fs.readFile(fullPath, 'utf-8');
        const result = await processor.process(mdContent);
        const html = renderHtml(result.toString(), path.basename(fullPath));

        reply.type('text/html').send(html);
    } catch (err) {
        if (err.code === 'ENOENT') {
            reply.code(404).send('Not Found');
        } else {
            fastify.log.error(err);
            reply.code(500).send('Internal Server Error');
        }
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log(`Server listening on http://localhost:3000`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
