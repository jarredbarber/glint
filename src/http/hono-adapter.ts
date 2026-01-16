/**
 * Hono adapter - wraps Hono to use abstract HTTP types.
 * Used by Cloudflare Workers.
 */

import type { Context as HonoContext, Hono } from 'hono';
import type {
    HttpRequest,
    HttpResponse,
    HttpContext,
    HttpAdapter,
    RouteHandler,
    RouteDefinition
} from './types.js';

/**
 * Create abstract HttpRequest from Hono context
 */
function createRequest<TParams, TBody, TQuery>(
    c: HonoContext,
    body?: TBody
): HttpRequest<TParams, TBody, TQuery> {
    const url = new URL(c.req.url);
    const query = Object.fromEntries(url.searchParams.entries()) as TQuery;

    return {
        params: c.req.param() as TParams,
        body: body as TBody,
        query,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        method: c.req.method,
        url: url.pathname,
        rawBody: undefined, // Set after body parsing if needed
        isAuthenticated: () => (c as any).get?.('authenticated') ?? false,
        getAccess: () => (c as any).get?.('access') ?? 'view',
    };
}

/**
 * Create abstract HttpResponse from Hono context
 */
function createResponse(c: HonoContext): HttpResponse {
    let statusCode = 200;
    const headers: Record<string, string> = {};

    // Store the response to be returned by the handler wrapper
    let pendingResponse: Response | null = null;

    const response: HttpResponse & { _getResponse: () => Response | null } = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        header(name: string, value: string) {
            headers[name] = value;
            return this;
        },
        json(data: unknown) {
            c.status(statusCode as any);
            for (const [k, v] of Object.entries(headers)) {
                c.header(k, v);
            }
            pendingResponse = c.json(data);
        },
        text(data: string) {
            c.status(statusCode as any);
            for (const [k, v] of Object.entries(headers)) {
                c.header(k, v);
            }
            pendingResponse = c.text(data);
        },
        html(data: string) {
            c.status(statusCode as any);
            for (const [k, v] of Object.entries(headers)) {
                c.header(k, v);
            }
            pendingResponse = c.html(data);
        },
        send(data: string | Buffer | Uint8Array, contentType?: string) {
            c.status(statusCode as any);
            for (const [k, v] of Object.entries(headers)) {
                c.header(k, v);
            }
            if (contentType) {
                c.header('Content-Type', contentType);
            }
            // Convert Buffer to ArrayBuffer for Hono compatibility
            const bodyData = data instanceof Buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
            pendingResponse = new Response(bodyData as BodyInit);
        },
        redirect(url: string, code = 302) {
            pendingResponse = c.redirect(url, code as any);
        },
        _getResponse() {
            return pendingResponse;
        }
    };

    return response;
}

/**
 * Create HttpContext from Hono context
 */
async function createContext<TParams, TBody, TQuery>(
    c: HonoContext
): Promise<HttpContext<TParams, TBody, TQuery>> {
    // Parse body based on content type
    let body: TBody | undefined;
    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('application/json')) {
        try {
            body = await c.req.json() as TBody;
        } catch {
            body = undefined;
        }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
            const formData = await c.req.parseBody();
            body = formData as TBody;
        } catch {
            body = undefined;
        }
    }

    return {
        request: createRequest<TParams, TBody, TQuery>(c, body),
        response: createResponse(c),
        log: {
            info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
            error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
            warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
            debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
        },
    };
}

/**
 * Wrap an abstract RouteHandler for Hono
 */
export function wrapHandler<TParams = unknown, TBody = unknown, TQuery = unknown>(
    handler: RouteHandler<TParams, TBody, TQuery>
): (c: HonoContext) => Promise<Response | void> {
    return async (c: HonoContext) => {
        const ctx = await createContext<TParams, TBody, TQuery>(c);
        await handler(ctx);
    };
}

/**
 * Hono HTTP adapter
 */
export class HonoAdapter implements HttpAdapter {
    constructor(private app: Hono) { }

    register(route: RouteDefinition): void {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
        this.app[method](route.path, wrapHandler(route.handler));
    }

    registerAll(routes: RouteDefinition[]): void {
        for (const route of routes) {
            this.register(route);
        }
    }

    static(prefix: string, _directory: string): void {
        // On Workers, static files are served from R2/KV, not a local directory
        // This is a no-op; static asset serving is handled by the R2 storage provider
    }

    getApp(): Hono {
        return this.app;
    }
}
