# Feasibility Report: Hosting Glint on Cloudflare Workers

## Executive Summary

**Verdict:** Not directly portable. Requires significant re-architecture.

Glint is currently designed as a **Node.js application** with direct filesystem access. Cloudflare Workers runs on the V8 Edge Runtime (workerd), which does not support Node.js filesystem APIs or the Fastify web framework.

---

## Compatibility Gaps

### 1. File System Access (`node:fs`)

- **Current:** Glint reads/writes markdown files directly from user's disk using `node:fs/promises`.
- **Workers:** No local filesystem. Data must reside in **Workers KV** or **R2 Storage**.
- **Impact:** You cannot simply point Glint at a folder on your computer. You would need to upload your content to R2.

### 2. Web Framework (`fastify`)

- **Current:** Uses Fastify, which relies on Node's `http` and `net` modules.
- **Workers:** Fastify does not run on Workers.
- **Solution:** Migrate to [Hono](https://hono.dev/) (very similar API, built for edge) or native `fetch` handlers.

### 3. Server-Side Events (Hot Reload)

- **Current:** Uses `EventEmitter` and Node streams for SSE.
- **Workers:** Supported via `ReadableStream`, but needs reimplementation.

### 4. Unified Ecosystem

- **Current:** Uses `unified`, `remark`, `rehype`.
- **Workers:** Most `unified` plugins are pure JS and **will work fine**. This is the good news!

### 5. Child Processes

- **Current:** Local nvim/node processes (if we used them).
- **Workers:** No child processes allowed.

---

## Migration Path

To run on Cloudflare Workers, Glint would become "Glint Cloud":

1. **Replace Fastify with Hono**

   ```typescript
   const app = new Hono()
   app.get('/*', async (c) => { ... })
   export default app
   ```

2. **Replace FS with R2**

   ```typescript
   // Instead of fs.readFile
   const object = await env.MY_BUCKET.get(key)
   const content = await object.text()
   ```

3. **Admin UI for Uploads**
   - Since you can't edit local files, you need a web IDE to edit `R2` content directly (Glint's editor is actually perfect for this!).

---

## Recommendation

If the goal is **"Share my local folder on the web"**:
-> Use **Cloudflare Tunnel** (`cloudflared`). It exposes your locally running Glint server to the internet securely. Zero code changes required.

If the goal is **"Serverless Markdown Hosting"**:
-> A rewrite to Hono + R2 is feasible and would be a great project, but it is a rewrite, not a "host as-is" task.
