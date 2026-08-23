import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import * as toml from 'smol-toml';

/**
 * Available theme names for Glint.
 */
export const AVAILABLE_THEMES = [
    'default',
    'ayu-dark',
    'ayu-light',
    'catppuccin-latte',
    'catppuccin-mocha',
    'dracula',
    'everforest-dark',
    'github-light',
    'gruvbox-dark',
    'kanagawa',
    'moonlight',
    'nord',
    'one-dark',
    'rose-pine',
    'rose-pine-dawn',
    'solarized-light',
    'tokyo-night'
] as const;

// Render configuration shared by the CLI renderer and the browser pipeline.
const ConfigSchema = z.object({
    theme: z.string().default('nord'),
    baseFile: z.string().default('README.md'),
    'latex-macros': z.record(z.string(), z.string()).optional(),
});

export type GlintConfig = z.infer<typeof ConfigSchema>;

const DEFAULTS: GlintConfig = {
    theme: 'nord',
    baseFile: 'README.md',
};

export async function loadConfig(contentDir: string, configPath?: string): Promise<GlintConfig> {
    const dotGlintDir = path.join(contentDir, '.glint');
    const paths = configPath ? [configPath] : [
        path.join(contentDir, 'glint.toml'),
        path.join(dotGlintDir, 'config.toml'),
    ];

    let raw: string | undefined;

    for (const p of paths) {
        try {
            raw = await fs.readFile(p, 'utf-8');
            break;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
    }

    if (!raw) return DEFAULTS;

    const parsed = toml.parse(raw);
    return ConfigSchema.parse({ ...DEFAULTS, ...parsed });
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
