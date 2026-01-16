---
title: Hector Service Integration
author: Jarred Barber
date: 2026-01-15
---


## Overview

This guide details how external services (specifically the Hector AI agent) interface with Glint to manage documents, assets, and storage.

## Authentication

All service requests must be authenticated using a **Service Token**.

### 1. Generating a Token

Use the Glint CLI to generate a token:

```bash
glint auth-token generate
# Output: glint_sk_abc123...
```

### 2. Configuring Glint

Store the token hash in `.glint/config.json` (Glint handles this automatically when using the CLI command above).

### 3. Making Requests

Include the token in the `Authorization` header of every HTTP request:

```http
Authorization: Bearer <your-service-token>
```

---

## Document API

### Read a Document

**GET** `/api/documents/:path`

Retrieves the raw content of a document.

**Parameters:**

- `path` (URL Param): The full storage path (e.g., `hector:alice/todo.md`)

**Response:**

```json
{
  "markdown": "# Todo List\n- [ ] Task 1",
  "hash": "abc123hash..."
}
```

### Read Rendered Content (For Analysis)

**GET** `/api/documents/:path?render=true`

Retrieves the pre-rendered HTML. Useful if Hector needs to analyze the structure or task lists as Glint sees them.

**Response:**

```json
{
  "html": "<h1>Todo List</h1>...",
  "headings": [{ "depth": 1, "value": "Todo List", "id": "todo-list" }],
  "frontmatter": { "tags": ["personal"] },
  "hash": "abc123hash..."
}
```

### Write a Document

**PUT** `/api/documents/:path`

Creates or updates a document.

**Body:**

```json
{
  "content": "# New Content...",
  "message": "Alice: Completed task 1",
  "expectedHash": "abc123hash..." // Optional: Optimistic locking
}
```

- **`message`**: This string is used as the Git commit message. Glint recommends prefixing it with the attributed user's name (e.g., "Alice: ...").
- **`expectedHash`**:  (Optional) The hash of the file *before* this edit. If the file has changed on the server since then, the request fails with `409 Conflict`.

### Delete a Document

**DELETE** `/api/documents/:path`

Permanently removes a document.

---

## Asset Management

### Upload an Image

**POST** `/api/upload`

Uploads a binary asset (image, PDF, etc.) associated with a specific document.

**Content-Type**: `multipart/form-data`

**Fields:**

- `file`: The binary file content.
- `articlePath`: The path of the document this asset belongs to (e.g., `hector:alice/journal.md`).

**Response:**

```json
{
  "url": "/hector:alice/journal.md.assets/8f3a1e.png"
}
```

The returned `url` is an absolute path that can be inserted directly into the markdown:

```markdown
![Screenshot](/hector:alice/journal.md.assets/8f3a1e.png)
```

---

## Git Operations

If the storage mount is backed by Git (which Hector's data usually is), you can trigger sync operations manually.

**GET** `/api/git/status`

- Check if the repo is clean, ahead, or behind.

**POST** `/api/git/sync`

- Triggers a Commit -> Pull -> Push cycle.
- Useful to force-push changes to the remote immediately after a series of edits.

---

## Health Check

**GET** `/health`

Returns `200 OK` structure if the server is healthy.

```json
{
  "status": "healthy"
}
```
