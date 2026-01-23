import { FastifyInstance, FastifyReply } from 'fastify';

export function setupSSERoutes(fastify: FastifyInstance) {
    const clients = new Set<FastifyReply>();

    fastify.get('/events', (request, reply) => {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.write('\n');

        clients.add(reply);

        request.raw.on('close', () => {
            clients.delete(reply);
        });
    });

    const broadcast = (data: string, event?: string) => {
        for (const client of clients) {
            if (event) {
                client.raw.write(`event: ${event}\n`);
            }
            client.raw.write(`data: ${data}\n\n`);
        }
    };

    return { broadcast };
}
