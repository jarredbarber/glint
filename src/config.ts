import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const PublicPathSchema = z.object({
    path: z.string(),
    access: z.enum(['view', 'comment', 'edit']).default('view'),
});

const AuthSchema = z.object({
    enabled: z.boolean().default(false),
    passwordHash: z.string().optional(),
    sessionSecret: z.string().optional(),
    public: z.array(PublicPathSchema).default([]),
});

const ConfigSchema = z.object({
    port: z.coerce.number().default(3000),
    host: z.string().default('0.0.0.0'),
    theme: z.string().default('nord'),
    baseFile: z.string().default('README.md'),
    'latex-macros': z.record(z.string(), z.string()).optional(),
    auth: AuthSchema.optional(),
});

export type GlintConfig = z.infer<typeof ConfigSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type PublicPath = z.infer<typeof PublicPathSchema>;
export type AccessLevel = 'view' | 'comment' | 'edit';

const DEFAULTS: GlintConfig = {
    port: 3000,
    host: '0.0.0.0',
    theme: 'nord',
    baseFile: 'README.md',
};

export async function loadConfig(contentDir: string): Promise<GlintConfig> {
    const configPath = path.join(contentDir, 'glint.json');

    try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const config = ConfigSchema.parse({ ...DEFAULTS, ...parsed });

        // Process latex-macros if present
        if (config['latex-macros']) {
            const macros: Record<string, string> = {};
            for (const [key, value] of Object.entries(config['latex-macros'])) {
                macros[`\\${key}`] = value;
            }
            // Overwrite the original 'latex-macros' with the processed version
            // This ensures the type is correct for later use
            config['latex-macros'] = macros;
        }

        return config;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return DEFAULTS;
        }
        throw err;
    }
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
