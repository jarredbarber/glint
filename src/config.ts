import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import * as toml from 'smol-toml';

/**
 * Available theme names for Glint.
 * Centralized to avoid duplication across API routes and UI.
 */
export const AVAILABLE_THEMES = [
    'default',
    'everforest-dark',
    'nord',
    'gruvbox-dark',
    'catppuccin-mocha',
    'solarized-light',
    'tokyo-night',
    'rose-pine',
    'dracula',
    'one-dark',
    'kanagawa',
    'github-light'
] as const;

const PublicPathSchema = z.object({
    path: z.string(),
    access: z.enum(['view', 'comment', 'edit']).default('view'),
});

const AuthSchema = z.object({
    enabled: z.boolean().default(false),
    passwordHash: z.string().optional(),
    sessionSecret: z.string().optional(),
    serviceToken: z.string().optional(),  // For programmatic API access (Hector)
    public: z.array(PublicPathSchema).default([]),
});

const StorageProviderSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('local'),
        basePath: z.string().default('.'),
    }),
    z.object({
        type: z.literal('git'),
        basePath: z.string(),
        autoCommit: z.boolean().default(true),
        autoSync: z.boolean().default(true),
        syncInterval: z.number().default(60),
        commitMessage: z.string().optional(),
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
    default: z.string().optional(),
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
    headless: z.boolean().default(false),
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
    headless: false,
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
        path.join(contentDir, 'glint.toml'),
        path.join(dotGlintDir, 'config.toml'),
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
        const parsed = toml.parse(raw);
        return ConfigSchema.parse({ ...DEFAULTS, ...parsed });
    } catch (err) {
        throw err;
    }
}

/**
 * Save configuration to the content directory.
 * If configPath is provided, saves to that specific file instead.
 */
export async function saveConfig(contentDir: string, config: Partial<GlintConfig>, configPath?: string): Promise<void> {
    const fullConfig = { ...DEFAULTS, ...config };
    const content = toml.stringify(fullConfig);

    if (configPath) {
        const dir = path.dirname(configPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(configPath, content, 'utf-8');
        return;
    }

    const dotGlintDir = path.join(contentDir, '.glint');
    const tomlPath = path.join(contentDir, 'glint.toml');
    const oldTomlPath = path.join(dotGlintDir, 'config.toml');

    let targetPath = tomlPath;
    try {
        await fs.access(tomlPath);
    } catch {
        try {
            await fs.access(oldTomlPath);
            targetPath = oldTomlPath;
        } catch {
            // None exist, use default
        }
    }

    await fs.writeFile(targetPath, content, 'utf-8');
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
 * Get the path to the current config file.
 */
export async function getConfigPath(contentDir: string): Promise<string> {
    const paths = [
        path.join(contentDir, 'glint.toml'),
        path.join(contentDir, '.glint', 'config.toml'),
    ];

    for (const p of paths) {
        try {
            await fs.access(p);
            return p;
        } catch { }
    }

    return paths[0]; // Default to glint.toml for creation
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
