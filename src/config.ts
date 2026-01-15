import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import * as toml from 'smol-toml';

const PublicPathSchema = z.object({
    path: z.string(),
    access: z.enum(['view', 'comment', 'edit']).default('view'),
});

const AuthSchema = z.object({
    enabled: z.boolean().default(false),
    passwordHash: z.string().optional(),
    sessionSecret: z.string().optional(),
    public: z.array(PublicPathSchema).default([]),
    serviceTokenHash: z.string().optional(),
});

const StorageProviderSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('local'),
        basePath: z.string().default('.'),
    }),
    z.object({
        type: z.literal('github'),
        owner: z.string(),
        repo: z.string(),
        branch: z.string().optional(),
        token: z.string().optional(),
    }),
]);

const MountSchema = z.object({
    prefix: z.string(),
    provider: z.string(),
});

const CacheConfigSchema = z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(300000), // 5 minutes
    maxSize: z.number().default(100 * 1024 * 1024), // 100MB
});

const StorageConfigSchema = z.object({
    default: z.string().default('local'),
    providers: z.record(z.string(), StorageProviderSchema).default({
        local: { type: 'local', basePath: '.' }
    }),
    mounts: z.array(MountSchema).default([]),
    cache: CacheConfigSchema.default(() => ({
        enabled: true,
        ttl: 300000,
        maxSize: 100 * 1024 * 1024
    })),
});

const ConfigSchema = z.object({
    port: z.coerce.number().default(3000),
    host: z.string().default('0.0.0.0'),
    theme: z.string().default('nord'),
    baseFile: z.string().default('README.md'),
    'latex-macros': z.record(z.string(), z.string()).optional(),
    auth: AuthSchema.optional(),
    storage: StorageConfigSchema.default(() => ({
        default: 'local',
        providers: {
            local: { type: 'local' as const, basePath: '.' }
        },
        mounts: [],
        cache: {
            enabled: true,
            ttl: 300000,
            maxSize: 100 * 1024 * 1024
        }
    })),
    github: z.object({
        webhookSecret: z.string().optional(),
        token: z.string().optional(),
    }).optional(),
});

export type GlintConfig = z.infer<typeof ConfigSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type PublicPath = z.infer<typeof PublicPathSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type StorageProviderConfig = z.infer<typeof StorageProviderSchema>;
export type MountConfig = z.infer<typeof MountSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type AccessLevel = 'view' | 'comment' | 'edit';

const DEFAULTS: GlintConfig = {
    port: 3000,
    host: '0.0.0.0',
    theme: 'nord',
    baseFile: 'README.md',
    storage: {
        default: 'local',
        providers: {
            local: { type: 'local', basePath: '.' }
        },
        mounts: [],
        cache: {
            enabled: true,
            ttl: 300000,
            maxSize: 100 * 1024 * 1024
        }
    }
};

export async function loadConfig(contentDir: string, configPath?: string): Promise<GlintConfig> {
    const dotGlintDir = path.join(contentDir, '.glint');
    const paths = configPath ? [configPath] : [
        path.join(dotGlintDir, 'config.toml'),
        path.join(dotGlintDir, 'config.json'),
        path.join(contentDir, 'glint.toml'),
        path.join(contentDir, 'glint.json'),
    ];

    let raw: string | undefined;
    let actualConfigPath: string | undefined;

    for (const p of paths) {
        try {
            raw = await fs.readFile(p, 'utf-8');
            actualConfigPath = p;
            break;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
    }

    if (!raw || !actualConfigPath) {
        return DEFAULTS;
    }

    try {
        const isToml = actualConfigPath.endsWith('.toml');
        const parsed = isToml ? toml.parse(raw) : JSON.parse(raw);

        // Automatic migration if it's an old glint.json/toml without .glint directory
        if (!configPath && (actualConfigPath === path.join(contentDir, 'glint.json') || actualConfigPath === path.join(contentDir, 'glint.toml'))) {
            const newExt = isToml ? '.toml' : '.json';
            const newConfigPath = path.join(dotGlintDir, 'config' + newExt);
            await fs.mkdir(dotGlintDir, { recursive: true });
            await fs.writeFile(newConfigPath, raw, 'utf-8');
        }

        return ConfigSchema.parse({ ...DEFAULTS, ...parsed });
    } catch (err) {
        throw err;
    }
}

/**
 * Save configuration to the content directory (prefers .glint/config.toml).
 */
export async function saveConfig(contentDir: string, config: Partial<GlintConfig>): Promise<void> {
    const dotGlintDir = path.join(contentDir, '.glint');
    const tomlPath = path.join(dotGlintDir, 'config.toml');
    const jsonPath = path.join(dotGlintDir, 'config.json');

    // If .glint isn't there, we'll create it
    await fs.mkdir(dotGlintDir, { recursive: true });

    // Check if JSON exists and we should stick with it, but prefer TOML for new/updates
    let useJson = false;
    try {
        await fs.access(jsonPath);
        // Only stay on JSON if TOML doesn't exist yet
        try {
            await fs.access(tomlPath);
        } catch {
            useJson = true;
        }
    } catch { }

    const fullConfig = { ...DEFAULTS, ...config };
    const content = useJson
        ? JSON.stringify(fullConfig, null, 4)
        : toml.stringify(fullConfig);

    await fs.writeFile(useJson ? jsonPath : tomlPath, content, 'utf-8');
}

/**
 * Get processed LaTeX macros with leading backslashes for KaTeX.
 */
export function getProcessedMacros(config: GlintConfig): Record<string, string> {
    const rawMacros = config['latex-macros'] || {};
    const processed: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMacros)) {
        const processedKey = key.startsWith('\\') ? key : `\\${key}`;
        processed[processedKey] = value;
    }
    return processed;
}

/**
 * Get the path to the current config file (prefers .glint/config.json).
 */
export async function getConfigPath(contentDir: string): Promise<string> {
    const paths = [
        path.join(contentDir, '.glint', 'config.toml'),
        path.join(contentDir, '.glint', 'config.json'),
        path.join(contentDir, 'glint.toml'),
        path.join(contentDir, 'glint.json'),
    ];

    for (const p of paths) {
        try {
            await fs.access(p);
            return p;
        } catch { }
    }

    return paths[0]; // Default to .glint/config.toml for creation
}

/**
 * Check if a URL path is publicly accessible and return its access level.
 * Returns null if the path is not public (requires authentication).
 */
export function getPublicAccess(config: GlintConfig, urlPath: string): AccessLevel | null {
    if (!config.auth?.enabled) {
        return 'edit'; // No auth = full access
    }

    const publicPaths = config.auth.public || [];

    for (const rule of publicPaths) {
        if (matchesPattern(urlPath, rule.path)) {
            return rule.access;
        }
    }

    return null; // Not public
}

/**
 * Simple glob pattern matching for path rules.
 * Supports * (single segment) and ** (multiple segments).
 */
function matchesPattern(urlPath: string, pattern: string): boolean {
    // Normalize paths (remove leading/trailing slashes)
    const normalizedPath = urlPath.replace(/^\/+|\/+$/g, '');
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '');

    // Exact match
    if (normalizedPattern === normalizedPath) {
        return true;
    }

    // Convert glob pattern to regex
    const regexPattern = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*\*/g, '<<GLOBSTAR>>') // Temporarily replace **
        .replace(/\*/g, '[^/]*') // * matches anything except /
        .replace(/<<GLOBSTAR>>/g, '.*'); // ** matches anything including /

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
}
