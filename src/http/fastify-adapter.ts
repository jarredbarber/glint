/**
 * Fastify adapter - wraps Fastify to use abstract HTTP types.
 * Used by the Node.js server.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
    HttpRequest,
    HttpResponse,
    HttpContext,
    HttpAdapter,
    RouteHandler,
    RouteDefinition
} from './types.js';

/**
 * Create abstract HttpRequest from Fastify request
 */
function createRequest<TParams, TBody, TQuery>(
    req: FastifyRequest
): HttpRequest<TParams, TBody, TQuery> {
    return {
        params: req.params as TParams,
        body: req.body as TBody,
        query: req.query as TQuery,
        headers: req.headers as Record<string, string | string[] | undefined>,
        method: req.method,
        url: req.url,
        rawBody: typeof req.body === 'string' ? req.body : undefined,
        isAuthenticated: () => (req as any).isAuthenticated?.() ?? false,
        getAccess: () => (req as any).getAccess?.() ?? 'edit',
    };
}

/**
 * Create abstract HttpResponse from Fastify reply
 */
function createResponse(reply: FastifyReply): HttpResponse {
    return {
        status(code: number) {
            reply.code(code);
            return this;
        },
        header(name: string, value: string) {
            reply.header(name, value);
            return this;
        },
        json(data: unknown) {
            reply.type('application/json').send(data);
        },
        text(data: string) {
            reply.type('text/plain').send(data);
        },
        html(data: string) {
            reply.type('text/html').send(data);
        },
        send(data: string | Buffer | Uint8Array, contentType?: string) {
            if (contentType) {
                reply.type(contentType);
            }
            reply.send(data);
        },
        redirect(url: string, code = 302) {
            reply.redirect(url, code);
        },
    };
}

/**
 * Create HttpContext from Fastify request/reply
 */
function createContext<TParams, TBody, TQuery>(
    req: FastifyRequest,
    reply: FastifyReply
): HttpContext<TParams, TBody, TQuery> {
    return {
        request: createRequest<TParams, TBody, TQuery>(req),
        response: createResponse(reply),
        log: {
            info: (msg) => req.log.info(msg),
            error: (msg) => req.log.error(typeof msg === 'string' ? msg : (msg as Error)),
            warn: (msg) => req.log.warn(msg),
            debug: (msg) => req.log.debug(msg),
        },
    };
}

/**
 * Wrap an abstract RouteHandler for Fastify
 */
export function wrapHandler<TParams = unknown, TBody = unknown, TQuery = unknown>(
    handler: RouteHandler<TParams, TBody, TQuery>
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const ctx = createContext<TParams, TBody, TQuery>(req, reply);
        await handler(ctx);
    };
}

/**
 * Fastify HTTP adapter
 */
export class FastifyAdapter implements HttpAdapter {
    constructor(private fastify: FastifyInstance) { }

    register(route: RouteDefinition): void {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
        this.fastify[method](route.path, wrapHandler(route.handler));
    }

    registerAll(routes: RouteDefinition[]): void {
        for (const route of routes) {
            this.register(route);
        }
    }

    static(prefix: string, directory: string): void {
        // Static file serving is handled separately in Fastify via fastify-static
        // This is a no-op here; use fastify.register(fastifyStatic, ...) directly
    }

    async listen(port: number, host: string): Promise<string> {
        return this.fastify.listen({ port, host });
    }

    getApp(): FastifyInstance {
        return this.fastify;
    }
}
