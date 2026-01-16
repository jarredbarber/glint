/**
 * HTTP abstraction layer - exports for both Fastify and Hono adapters
 */

export type {
    HttpRequest,
    HttpResponse,
    HttpContext,
    HttpAdapter,
    RouteHandler,
    RouteDefinition
} from './types.js';

export { FastifyAdapter, wrapHandler as wrapFastifyHandler } from './fastify-adapter.js';
export { HonoAdapter, wrapHandler as wrapHonoHandler } from './hono-adapter.js';
