---
title: Glint Storage API Design
author: Jarred Barber
date: 2026-01-12
---

## Overview

The Glint Storage API abstracts file storage operations behind a pluggable interface. This enables:

- **Multiple backends**: Local filesystem, GitHub, S3, etc.
- **Mount-based routing**: Different document trees use different storage providers
- **Hector integration**: Clean REST API for Hector AI to read/write documents
- **Git preservation**: GitHub's version history and PR workflows remain intact

The storage layer sits between Glint's document processing pipeline and actual file storage.

---

## Architecture

### Storage Provider Interface

All storage backends implement `StorageProvider`:

```typescript
export interface StorageProvider {
  name: string;

  // Core CRUD operations
  read(path: string): Promise<string>;
  write(path: string, content: string, message?: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  move(oldPath: string, newPath: string): Promise<void>;

  // Directory operations
  list(directory: string): Promise<FileEntry[]>;

  // Full-text search (optional)
  search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // Version history (optional, mainly GitHub)
  history?(path: string): Promise<VersionEntry[]>;
}
```

### Storage Manager (Router)

`StorageManager` maps paths to providers using prefixes:

```typescript
// Examples:
// "notes:bio.md" → private-notes provider
// "hector:64meacham/warwick.md" → hector-data provider
// "tasks.md" → default local provider
```

**Resolution algorithm** (longest prefix wins):

1. Check if path starts with a registered mount prefix
2. Return that provider + stripped path
3. Fall back to default provider

---

## Providers

### LocalStorageProvider

Stores files on the filesystem. Used for:

- Local development
- Personal Glint instances
- Non-critical content

**Features:**

- Simple read/write/list operations
- No version history
- No search (yet)

**Usage:**

```json
{
  "type": "local",
  "basePath": "./content"
}
```

### GitHubStorageProvider

Reads/writes files via GitHub API. Used for:

- Hector's document storage
- Shared wikis with PR workflows
- Version-controlled content

**Features:**

- Read files with HTTP caching
- Write with auto-retry on conflicts (409)
- List files and directories
- Full commit history
- Rate limit tracking
- Webhook support for cache invalidation

**Conflict Handling (409):**

When two clients edit the same file concurrently:

1. Client A gets SHA from GitHub
2. Client B modifies and commits (new SHA)
3. Client A's write fails with 409 Conflict
4. Client A retries: gets new SHA, commits again

Retry logic uses exponential backoff (100ms, 200ms, 300ms).

**Rate Limits:**

GitHub allows 5000 API calls/hour per PAT. Provider tracks:

- `rateLimitRemaining`: API quota left
- `rateLimitReset`: When quota resets

Exposed via `getRateLimitStatus()` for monitoring.

**Usage:**

```json
{
  "type": "github",
  "owner": "jarredbarber",
  "repo": "hector-data",
  "branch": "main"
}
```

---

## Authentication

Service token authentication for Hector:

**Setup:**

- Generate token: `glint auth-token generate`
- Store plaintext in Hector's env var: `GLINT_SERVICE_TOKEN`
- Glint stores bcrypt hash in `.glint/config.json`

**Usage:**
All Hector requests include:

```
Authorization: Bearer <service-token>
```

Glint validates token on protected routes. No user accounts in Glint — Hector manages access control for alice/bob.

---

## API Routes

### Document Management (Hector Integration)

Designed for the Hector AI agent to read/write documents using a service token.

**GET `/api/documents/:path`**

- Returns: raw markdown + metadata
- Query: `?render=true` to get pre-rendered HTML (cached)
- Example: `GET /api/documents/hector:alice/file.md`

**PUT `/api/documents/:path`**

- Write document to storage (requires service token)
- Body: `{ content: string, message?: string, expectedHash?: string }`
- Note: `message` is used for the git commit message.

**DELETE `/api/documents/:path`**

- Delete document from storage (requires service token)

**POST `/api/documents/render`**

- Render markdown to HTML without storage (preview)
- Body: `{ markdown: string }`

### Editor Operations (Client)

Endpoints used by the Glint web client for inline editing and asset management.

**POST `/api/save`**

- Save content with optimistic locking
- Body: `{ path: string, content: string, hash?: string }`
- Returns: `{ success: true, hash: string }`
- Error: `409 Conflict` if hash mismatch

**GET `/api/source/*`**

- Fetch raw content for editing
- Returns: `{ content: string, hash: string, path: string }`

**POST `/api/upload`**

- Upload image/asset
- Multipart Form: `file` (binary), `articlePath` (string)
- Returns: `{ url: string }` (absolute path to asset)

**GET `/api/asset/resolve`**

- Serve asset content securely
- Query: `?path=/path/to/asset.png`

**POST `/api/theme`**

- Update global theme
- Body: `{ theme: string }`

### Git Operations

Manage backend git state (requires `edit` permission).

**GET `/api/git/status`**

- Returns: `{ isRepo: boolean, hasChanges: boolean, ahead: number, behind: number, ... }`

**POST `/api/git/sync`**

- Trigger sync loop (Commit -> Pull -> Push)
- Returns: `{ success: boolean, ... }`

**POST `/api/git/pull`**

- Pull from remote
- Returns: `{ success: boolean, updates: number }`

**POST `/api/git/push`**

- Push to remote
- Returns: `{ success: boolean }`

### Share API

Manage time-limited access links.

**GET `/api/shares`**

- List active shares for a file
- Query: `?path=/path/to/file.md`

**POST `/api/shares`**

- Create new share link
- Body: `{ path: string, access: 'view'|'comment'|'edit', expiresAt?: number, label?: string }`

**DELETE `/api/shares/:id`**

- Revoke share link

### Health & Monitoring

**GET `/health`**

- Server health status
- Returns: `{ status: 'healthy'|'degraded' }`

---

## Configuration

### `.glint/config.json`

```json
{
  "storage": {
    "default": "local",
    "providers": {
      "local": {
        "type": "local",
        "basePath": "./content"
      }
    },
    "mounts": [
      {
        "prefix": "notes:",
        "provider": "local"
      }
    ]
  },
  "auth": {
    "serviceTokenHash": "$2b$10$..."
  },
  "github": {
    "webhookSecret": "your-webhook-secret",
    "token": "${GITHUB_TOKEN}"
  },
  "cache": {
    "enabled": true,
    "ttl": 300000,
    "maxSize": 104857600
  }
}
```

**Notes:**

- `github.token` should come from `GITHUB_TOKEN` env var, not config
- `webhookSecret` from GitHub repo settings
- `cache.ttl` in milliseconds (300000 = 5 minutes)
- `cache.maxSize` in bytes (104857600 = 100MB)

---

## Caching Strategy

### Why Cache?

GitHub API has strict rate limits. Without caching, even moderate usage would exhaust quota.

### How It Works

- **Layer**: Between `StorageManager` and `GitHubStorageProvider`
- **Key**: Full file path
- **TTL**: 5 minutes (configurable)
- **Size**: 100MB LRU cap
- **Invalidation**: GitHub webhooks
- **What gets cached**: Rendered HTML (including `data-source-line` attributes)

### Cache Invalidation

**Webhook-based (required for Hector):**

1. Configure GitHub repo to POST push events to `POST /webhooks/github`
2. Glint validates webhook signature (HMAC-SHA256)
3. Changed files are removed from cache immediately

This ensures that when either Glint or Hector edits a file:

- GitHub receives the commit
- Webhook fires → cache invalidates
- Next viewer request gets fresh content
- Works across both Glint's inline editor and Hector's viewer widget

---

## Hector Integration Notes

### Document Storage

Hector always stores documents in GitHub (never local):

- Stores alice's docs in `hector:alice/` prefix
- Stores bob's docs in `hector:bob/` prefix
- Stores shared docs in `hector:shared/` prefix

Hector manages access control — Glint just validates service token.

### Commits

Hector constructs the commit message itself, including user attribution:

```
PUT /api/documents/hector:alice/tasks.md
Authorization: Bearer <service-token>

{
  "content": "...",
  "message": "Alice: Update task dependencies"
}
```

Glint passes the message through to GitHub as-is. This way Glint doesn't need to know about alice/bob identities.

---

## Error Handling

### Rate Limit Exceeded

```
GitHubStorageProvider.write() detects: remaining < 10
Throws: Error("GitHub rate limited. Resets in 45m")
Health endpoint returns: 503 Service Unavailable
Hector falls back to direct GitHub access (if configured)
```

### Conflict (409)

```
Client A and B both edit file simultaneously
A's write returns 409 (SHA mismatch)
A retries with exponential backoff (max 3 attempts)
If all retries fail: throws Error("GitHub write failed")
```

### Provider Unavailable

```
GET /health → timeout or 500 error
Hector circuit breaker detects 3 consecutive failures
Glint falls back to direct storage access for 60s
```

---

## Files to Create/Modify

### New Files

```
src/storage/
├── types.ts          # StorageProvider interface + type definitions
├── local.ts          # LocalStorageProvider
├── github.ts         # GitHubStorageProvider (retry, rate limiting, webhook signature verification)
├── cache.ts          # LRU cache with TTL + webhook invalidation
└── index.ts          # StorageManager + mount routing

src/server/
├── auth.ts           # (Update) Add service token validation
└── routes/
    └── documents.ts  # GET/PUT/DELETE /api/documents/*, auth middleware
    └── webhooks.ts   # POST /webhooks/github (signature verification + cache invalidation)
```

### Modified Files

```
src/server.ts         # Initialize storage manager, integrate into pipeline
src/config.ts         # Add storage + auth.serviceTokenHash schemas
src/renderer.ts       # Update to use StorageManager for file tree
```

### No Changes Needed

```
src/client/          # Works with existing rendering
src/markdown.ts      # Works with storage content
```

---

## Testing Strategy

### Unit Tests

- **StorageProvider interface**: Mock implementations
- **StorageManager routing**: Path → provider resolution, prefix matching
- **GitHubStorageProvider**: Mock fetch() for success/retry/rate-limit scenarios
- **Cache**: TTL expiry, invalidation, size limits
- **Service token validation**: Bearer token parsing and hash comparison

### Integration Tests

- **Local provider**: Read/write actual files
- **GitHub provider**: Against real API (with test repo)
- **Webhook validation**: HMAC-SHA256 signature verification, cache invalidation
- **Rendering with source-line attributes**: Verify `data-source-line` in HTML

### E2E Tests

- **Hector integration**: Can Hector read/write via service token?
- **Concurrent access**: Glint inline editor + Hector making edits to same file
- **Cache behavior**: Verify webhook invalidation works across both editors
- **Multi-provider scenario**: One mount on GitHub, one local

---

## Performance Considerations

### Latency

- **Local reads**: ~1-2ms (disk)
- **Cached GitHub reads**: ~5-10ms (in-memory)
- **Uncached GitHub reads**: ~200-500ms (API call)
- **GitHub writes**: ~500-1000ms (API + git operations)

**Optimization**: Aggressive caching + webhook invalidation keeps most requests under 10ms.

### Concurrency

- Multiple clients can read simultaneously (no locking)
- Writes use GitHub's SHA-based optimistic locking
- Batch writes are atomic (all-or-nothing)

---

## Future Extensions

### S3/R2 Support

Add `S3StorageProvider` for:

- Backup storage
- Logs and media
- Disaster recovery

Requires similar config schema + path routing.

### GitLab Support

Add `GitLabStorageProvider` using GitLab's API (similar to GitHub).

### Search Across Providers

Implement `search()` method in providers + aggregation in `StorageManager`.

### Sync Between Providers

Mirror updates: write to GitHub, automatically sync to S3 backup.

---

## Deployment Checklist

- [ ] GitHub PAT stored in env var (`GITHUB_TOKEN`), not config
- [ ] Service token generated and shared with Hector (`glint auth-token generate`)
- [ ] Webhook secret configured in GitHub repo settings and `.glint/config.json`
- [ ] Webhook endpoint `POST /webhooks/github` accessible from GitHub
- [ ] Cache size limits set based on available memory
- [ ] Cache TTL tuned for your update frequency
- [ ] Rate limit alerts configured (< 1000 remaining)
- [ ] Logs configured for troubleshooting (GitHub 409 conflicts, webhook failures)
- [ ] Test: Hector can read/write via service token
- [ ] Test: Webhook fires and invalidates cache on commit
