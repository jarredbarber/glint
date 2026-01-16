/**
 * Abstract HTTP types for framework-agnostic route handlers.
 * Supports both Fastify (Node.js) and Hono (Cloudflare Workers).
 */

/**
 * Abstract HTTP request interface
 */
export interface HttpRequest<TParams = unknown, TBody = unknown, TQuery = unknown> {
    /** URL path parameters */
    params: TParams;

    /** Request body (parsed JSON/form) */
    body: TBody;

    /** Query string parameters */
    query: TQuery;

    /** HTTP headers */
    headers: Record<string, string | string[] | undefined>;

    /** HTTP method */
    method: string;

    /** Request URL path */
    url: string;

    /** Raw request body as string (for hashing, etc.) */
    rawBody?: string;

    /** Check if user is authenticated */
    isAuthenticated(): boolean;

    /** Get access level for current request */
    getAccess(): 'view' | 'comment' | 'edit';
}

/**
 * Abstract HTTP response interface
 */
export interface HttpResponse {
    /** Set HTTP status code */
    status(code: number): HttpResponse;

    /** Set response header */
    header(name: string, value: string): HttpResponse;

    /** Send JSON response */
    json(data: unknown): Promise<void> | void;

    /** Send plain text response */
    text(data: string): Promise<void> | void;

    /** Send HTML response */
    html(data: string): Promise<void> | void;

    /** Send raw response with content type */
    send(data: string | Buffer | Uint8Array, contentType?: string): Promise<void> | void;

    /** Redirect to URL */
    redirect(url: string, code?: number): Promise<void> | void;
}

/**
 * Handler context with request, response, and shared services
 */
export interface HttpContext<TParams = unknown, TBody = unknown, TQuery = unknown> {
    request: HttpRequest<TParams, TBody, TQuery>;
    response: HttpResponse;

    /** Logger instance */
    log: {
        info(msg: string, ...args: unknown[]): void;
        error(msg: string | Error, ...args: unknown[]): void;
        warn(msg: string, ...args: unknown[]): void;
        debug(msg: string, ...args: unknown[]): void;
    };
}

/**
 * Route handler function type
 */
export type RouteHandler<TParams = unknown, TBody = unknown, TQuery = unknown> = (
    ctx: HttpContext<TParams, TBody, TQuery>
) => Promise<void> | void;

/**
 * Route definition for registration
 */
export interface RouteDefinition {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    handler: RouteHandler<any, any, any>;
}

/**
 * HTTP adapter interface - implemented by Fastify and Hono adapters
 */
export interface HttpAdapter {
    /** Register a route */
    register(route: RouteDefinition): void;

    /** Register multiple routes */
    registerAll(routes: RouteDefinition[]): void;

    /** Register static file serving */
    static(prefix: string, directory: string): void;

    /** Start the server (Node.js only) */
    listen?(port: number, host: string): Promise<string>;

    /** Get the underlying app for export (Workers) */
    getApp(): unknown;
}
