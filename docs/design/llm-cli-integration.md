# LLM CLI Integration Design

**Status**: Draft
**Author**: Claude Code
**Date**: 2026-01-27

---

## Overview

This document describes a design for integrating LLM capabilities into Glint by shelling out to command-line interfaces (CLIs) like `claude` (Anthropic's Claude Code) or `gemini` (Google's CLI). This approach provides AI features without requiring API keys or direct HTTP integrations.

### Goals

1. **Zero configuration** - Use existing CLI auth (already logged in)
2. **Provider agnostic** - Support multiple LLM CLIs with unified interface
3. **Streaming support** - Real-time output for long-running operations
4. **Graceful degradation** - Features disabled when CLI unavailable
5. **Security** - No secrets in config, sandboxed execution

### Non-Goals

- Direct API integration (covered by separate design)
- Fine-tuning or model training
- Image generation (text-only for now)

---

## Supported CLIs

### Claude Code (`claude`)

```bash
# Check availability
claude --version

# Single prompt (print mode)
claude -p "Summarize this text: ..."

# With system prompt
claude -p "..." --system "You are a helpful assistant"

# Streaming output (default in print mode)
claude -p "..." --stream

# JSON output
claude -p "..." --output-format json
```

### Gemini CLI (`gemini`)

```bash
# Check availability
gemini --version

# Single prompt
gemini prompt "Summarize this text: ..."

# With system instruction
gemini prompt "..." --system "You are a helpful assistant"
```

### Ollama (`ollama`)

```bash
# Check availability
ollama --version

# Single prompt
ollama run llama3 "Summarize this text: ..."

# List available models
ollama list
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Glint Server                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   Widgets   │    │  API Routes  │    │   Markdown    │  │
│  │  (comment,  │    │  (/api/ai/*) │    │   Pipeline    │  │
│  │   task)     │    │              │    │              │  │
│  └──────┬──────┘    └──────┬───────┘    └───────┬───────┘  │
│         │                  │                    │          │
│         └──────────────────┼────────────────────┘          │
│                            ▼                               │
│                 ┌─────────────────────┐                    │
│                 │   LLMService        │                    │
│                 │   (src/llm/index)   │                    │
│                 └──────────┬──────────┘                    │
│                            │                               │
│         ┌──────────────────┼──────────────────┐            │
│         ▼                  ▼                  ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │ClaudeAdapter│    │GeminiAdapter│    │OllamaAdapter│    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │
│         │                  │                  │            │
└─────────┼──────────────────┼──────────────────┼────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
    ┌───────────┐      ┌───────────┐      ┌───────────┐
    │  claude   │      │  gemini   │      │  ollama   │
    │   CLI     │      │   CLI     │      │   CLI     │
    └───────────┘      └───────────┘      └───────────┘
```

---

## Interface Design

### Core Types

```typescript
// src/llm/types.ts

export interface LLMProvider {
    name: string;
    available: boolean;

    /** Check if CLI is installed and authenticated */
    checkAvailability(): Promise<boolean>;

    /** Generate a completion (non-streaming) */
    complete(request: CompletionRequest): Promise<CompletionResponse>;

    /** Generate a streaming completion */
    stream(request: CompletionRequest): AsyncGenerator<string, void, unknown>;
}

export interface CompletionRequest {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;

    /** Timeout in milliseconds (default: 60000) */
    timeout?: number;

    /** AbortSignal for cancellation */
    signal?: AbortSignal;
}

export interface CompletionResponse {
    content: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    model?: string;
    provider: string;
}

export interface LLMServiceConfig {
    /** Preferred provider order */
    providers: ('claude' | 'gemini' | 'ollama')[];

    /** Default timeout in ms */
    timeout: number;

    /** Ollama model to use */
    ollamaModel?: string;

    /** Enable/disable LLM features */
    enabled: boolean;
}
```

### LLM Service

```typescript
// src/llm/index.ts

import { spawn } from 'node:child_process';
import { LLMProvider, LLMServiceConfig, CompletionRequest, CompletionResponse } from './types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { OllamaAdapter } from './adapters/ollama.js';

export class LLMService {
    private providers: Map<string, LLMProvider> = new Map();
    private config: LLMServiceConfig;
    private availableProvider: LLMProvider | null = null;

    constructor(config: Partial<LLMServiceConfig> = {}) {
        this.config = {
            providers: ['claude', 'gemini', 'ollama'],
            timeout: 60000,
            enabled: true,
            ...config
        };

        this.providers.set('claude', new ClaudeAdapter());
        this.providers.set('gemini', new GeminiAdapter());
        this.providers.set('ollama', new OllamaAdapter(config.ollamaModel));
    }

    /** Initialize and find available provider */
    async init(): Promise<boolean> {
        if (!this.config.enabled) return false;

        for (const name of this.config.providers) {
            const provider = this.providers.get(name);
            if (provider && await provider.checkAvailability()) {
                this.availableProvider = provider;
                console.log(`[LLM] Using provider: ${name}`);
                return true;
            }
        }

        console.log('[LLM] No providers available');
        return false;
    }

    /** Check if LLM is available */
    isAvailable(): boolean {
        return this.availableProvider !== null;
    }

    /** Get the active provider name */
    getProviderName(): string | null {
        return this.availableProvider?.name ?? null;
    }

    /** Generate completion */
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        if (!this.availableProvider) {
            throw new Error('No LLM provider available');
        }
        return this.availableProvider.complete({
            timeout: this.config.timeout,
            ...request
        });
    }

    /** Generate streaming completion */
    async *stream(request: CompletionRequest): AsyncGenerator<string, void, unknown> {
        if (!this.availableProvider) {
            throw new Error('No LLM provider available');
        }
        yield* this.availableProvider.stream({
            timeout: this.config.timeout,
            ...request
        });
    }
}
```

### Claude Adapter

```typescript
// src/llm/adapters/claude.ts

import { spawn } from 'node:child_process';
import { LLMProvider, CompletionRequest, CompletionResponse } from '../types.js';

export class ClaudeAdapter implements LLMProvider {
    name = 'claude';
    available = false;

    async checkAvailability(): Promise<boolean> {
        try {
            const result = await this.exec(['--version']);
            this.available = result.includes('claude');
            return this.available;
        } catch {
            return false;
        }
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const args = this.buildArgs(request);
        const content = await this.exec(args, request.timeout, request.signal);

        return {
            content: content.trim(),
            provider: this.name
        };
    }

    async *stream(request: CompletionRequest): AsyncGenerator<string, void, unknown> {
        const args = this.buildArgs(request);

        const proc = spawn('claude', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Handle abort signal
        if (request.signal) {
            request.signal.addEventListener('abort', () => {
                proc.kill('SIGTERM');
            });
        }

        // Timeout handling
        const timeout = request.timeout ?? 60000;
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
        }, timeout);

        try {
            for await (const chunk of proc.stdout) {
                yield chunk.toString();
            }
        } finally {
            clearTimeout(timer);
        }

        // Check for errors
        const exitCode = await new Promise<number>((resolve) => {
            proc.on('close', resolve);
        });

        if (exitCode !== 0) {
            throw new Error(`Claude CLI exited with code ${exitCode}`);
        }
    }

    private buildArgs(request: CompletionRequest): string[] {
        const args = ['-p', request.prompt];

        if (request.systemPrompt) {
            args.push('--system', request.systemPrompt);
        }

        if (request.maxTokens) {
            args.push('--max-tokens', String(request.maxTokens));
        }

        return args;
    }

    private exec(args: string[], timeout = 30000, signal?: AbortSignal): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn('claude', args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data; });
            proc.stderr.on('data', (data) => { stderr += data; });

            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error('Command timed out'));
            }, timeout);

            if (signal) {
                signal.addEventListener('abort', () => {
                    proc.kill('SIGTERM');
                    reject(new Error('Command aborted'));
                });
            }

            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Exit code ${code}: ${stderr}`));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
}
```

---

## Use Cases in Glint

### 1. Smart Summarization

Add a "Summarize" button to long documents:

```typescript
// API endpoint
fastify.post('/api/ai/summarize', async (request, reply) => {
    const { content, maxLength } = request.body as { content: string; maxLength?: number };

    if (!llmService.isAvailable()) {
        return reply.code(503).send({ error: 'AI features unavailable' });
    }

    const response = await llmService.complete({
        prompt: content,
        systemPrompt: `Summarize the following text in ${maxLength || 200} words or less.
                       Preserve key points and maintain the original tone.`,
        timeout: 30000
    });

    return { summary: response.content };
});
```

### 2. Task Extraction

Extract tasks from meeting notes or documents:

```typescript
fastify.post('/api/ai/extract-tasks', async (request, reply) => {
    const { content } = request.body as { content: string };

    const response = await llmService.complete({
        prompt: content,
        systemPrompt: `Extract action items and tasks from this text.
                       Format each as a markdown task: "- [ ] task description"
                       Include any mentioned deadlines or assignees.
                       Return ONLY the task list, no other text.`
    });

    return { tasks: response.content };
});
```

### 3. Comment Thread Summarization

Summarize long comment discussions:

```typescript
// In comment widget or API
async function summarizeCommentThread(comments: CommentMessage[]): Promise<string> {
    const formatted = comments.map(c => `${c.author}: ${c.content}`).join('\n');

    const response = await llmService.complete({
        prompt: formatted,
        systemPrompt: `Summarize this discussion thread.
                       Identify: key points raised, decisions made, open questions.
                       Be concise (2-3 sentences).`
    });

    return response.content;
}
```

### 4. Writing Assistance (Streaming)

Real-time writing suggestions with SSE:

```typescript
fastify.get('/api/ai/assist', async (request, reply) => {
    const { prompt, context } = request.query as { prompt: string; context?: string };

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');

    try {
        for await (const chunk of llmService.stream({
            prompt,
            systemPrompt: context ? `Context: ${context}\n\nHelp the user with their writing.` : undefined
        })) {
            reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
    } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
    }

    reply.raw.end();
});
```

### 5. Intelligent Wiki Links

Suggest wiki links based on content:

```typescript
async function suggestWikiLinks(content: string, existingPages: string[]): Promise<string[]> {
    const response = await llmService.complete({
        prompt: `Content: ${content}\n\nExisting pages: ${existingPages.join(', ')}`,
        systemPrompt: `Analyze the content and suggest which existing pages should be linked.
                       Return a JSON array of page names that are relevant.
                       Only suggest pages that are semantically related to the content.`
    });

    try {
        return JSON.parse(response.content);
    } catch {
        return [];
    }
}
```

---

## Configuration

### Glint Config Schema

```typescript
// In src/config.ts

const LLMConfigSchema = z.object({
    enabled: z.boolean().default(true),
    providers: z.array(z.enum(['claude', 'gemini', 'ollama'])).default(['claude', 'gemini', 'ollama']),
    timeout: z.number().default(60000),
    ollamaModel: z.string().default('llama3'),
});

// Add to main config
const GlintConfigSchema = z.object({
    // ... existing fields
    llm: LLMConfigSchema.default({}),
});
```

### Example Configuration

```json
{
    "llm": {
        "enabled": true,
        "providers": ["claude", "ollama"],
        "timeout": 30000,
        "ollamaModel": "mistral"
    }
}
```

---

## Security Considerations

### Input Sanitization

```typescript
function sanitizePrompt(input: string): string {
    // Remove potential prompt injection attempts
    return input
        .replace(/```/g, '\\`\\`\\`')  // Escape code blocks
        .slice(0, 50000);               // Limit length
}
```

### Rate Limiting

```typescript
import { RateLimiter } from '../utils/rate-limiter.js';

const aiRateLimiter = new RateLimiter({
    windowMs: 60000,     // 1 minute
    maxRequests: 10,     // 10 requests per minute
});

fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/ai/')) {
        if (!aiRateLimiter.tryAcquire(request.ip)) {
            return reply.code(429).send({ error: 'Too many AI requests' });
        }
    }
});
```

### Sandboxing (Future)

For additional security, CLI execution could be sandboxed:

```typescript
// Using firejail or similar
const proc = spawn('firejail', [
    '--private',
    '--net=none',  // No network (CLI handles its own)
    'claude', '-p', prompt
]);
```

---

## Error Handling

```typescript
export class LLMError extends Error {
    constructor(
        message: string,
        public code: LLMErrorCode,
        public provider?: string,
        public cause?: Error
    ) {
        super(message);
        this.name = 'LLMError';
    }
}

export enum LLMErrorCode {
    PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
    TIMEOUT = 'TIMEOUT',
    RATE_LIMITED = 'RATE_LIMITED',
    INVALID_RESPONSE = 'INVALID_RESPONSE',
    CLI_ERROR = 'CLI_ERROR',
    ABORTED = 'ABORTED',
}

// Usage
try {
    const response = await llmService.complete({ prompt });
} catch (err) {
    if (err instanceof LLMError) {
        switch (err.code) {
            case LLMErrorCode.TIMEOUT:
                // Suggest shorter input or retry
                break;
            case LLMErrorCode.RATE_LIMITED:
                // Show rate limit message
                break;
            default:
                // Generic error handling
        }
    }
}
```

---

## UI Integration

### Feature Detection

```typescript
// Client-side check
async function checkAIAvailability(): Promise<boolean> {
    try {
        const res = await fetch('/api/ai/status');
        const { available, provider } = await res.json();
        return available;
    } catch {
        return false;
    }
}

// Conditionally show AI features
if (await checkAIAvailability()) {
    showAIButtons();
}
```

### Status Endpoint

```typescript
fastify.get('/api/ai/status', async () => {
    return {
        available: llmService.isAvailable(),
        provider: llmService.getProviderName(),
    };
});
```

---

## Testing

### Mock Provider

```typescript
// src/llm/adapters/mock.ts

export class MockAdapter implements LLMProvider {
    name = 'mock';
    available = true;

    private responses: Map<string, string> = new Map();

    setResponse(prompt: string, response: string) {
        this.responses.set(prompt, response);
    }

    async checkAvailability() { return true; }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const response = this.responses.get(request.prompt) || 'Mock response';
        return { content: response, provider: this.name };
    }

    async *stream(request: CompletionRequest) {
        const response = this.responses.get(request.prompt) || 'Mock response';
        for (const char of response) {
            yield char;
            await new Promise(r => setTimeout(r, 10));
        }
    }
}
```

### Integration Tests

```typescript
describe('LLMService', () => {
    it('should fall back to next provider', async () => {
        const service = new LLMService({
            providers: ['claude', 'ollama']
        });

        // Mock claude as unavailable
        jest.spyOn(service['providers'].get('claude')!, 'checkAvailability')
            .mockResolvedValue(false);

        await service.init();

        expect(service.getProviderName()).toBe('ollama');
    });

    it('should handle timeout', async () => {
        const service = new LLMService({ timeout: 100 });
        await service.init();

        await expect(service.complete({
            prompt: 'This will timeout',
            timeout: 1
        })).rejects.toThrow('timed out');
    });
});
```

---

## Future Considerations

### 1. Caching

Cache identical prompts to reduce CLI calls:

```typescript
const responseCache = new LRUCache<string, CompletionResponse>({
    max: 100,
    ttl: 1000 * 60 * 60 // 1 hour
});

function getCacheKey(request: CompletionRequest): string {
    return crypto.createHash('sha256')
        .update(JSON.stringify(request))
        .digest('hex');
}
```

### 2. Batch Processing

Queue and batch multiple requests:

```typescript
class LLMBatcher {
    private queue: Array<{ request: CompletionRequest; resolve: Function; reject: Function }> = [];

    async add(request: CompletionRequest): Promise<CompletionResponse> {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, resolve, reject });
            this.scheduleFlush();
        });
    }
}
```

### 3. Model Selection UI

Allow users to choose model in settings:

```typescript
// Get available models
fastify.get('/api/ai/models', async () => {
    const models = [];

    if (await claudeAdapter.checkAvailability()) {
        models.push({ provider: 'claude', model: 'claude-3-sonnet' });
    }

    if (await ollamaAdapter.checkAvailability()) {
        const ollamaModels = await ollamaAdapter.listModels();
        models.push(...ollamaModels.map(m => ({ provider: 'ollama', model: m })));
    }

    return { models };
});
```

### 4. Context Window Management

For long documents, implement chunking:

```typescript
async function processLongDocument(content: string): Promise<string> {
    const maxChunkSize = 10000; // chars
    const chunks = splitIntoChunks(content, maxChunkSize);

    const summaries = await Promise.all(
        chunks.map(chunk => llmService.complete({
            prompt: chunk,
            systemPrompt: 'Summarize this section concisely.'
        }))
    );

    // Combine summaries
    return llmService.complete({
        prompt: summaries.map(s => s.content).join('\n\n'),
        systemPrompt: 'Combine these section summaries into a cohesive overall summary.'
    }).then(r => r.content);
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create `src/llm/` directory structure
2. Implement `LLMProvider` interface and types
3. Implement `ClaudeAdapter` (primary target)
4. Add configuration schema
5. Basic `/api/ai/status` endpoint

### Phase 2: First Feature
1. Implement summarization endpoint
2. Add UI button for summarization
3. Error handling and user feedback
4. Rate limiting

### Phase 3: Additional Providers
1. Implement `OllamaAdapter`
2. Implement `GeminiAdapter`
3. Provider fallback logic
4. Model selection UI

### Phase 4: Advanced Features
1. Streaming responses
2. Task extraction
3. Wiki link suggestions
4. Comment summarization

---

## References

- [Claude Code CLI Documentation](https://docs.anthropic.com/claude-code)
- [Ollama Documentation](https://ollama.ai/docs)
- [Gemini CLI Documentation](https://cloud.google.com/gemini/docs/cli)
