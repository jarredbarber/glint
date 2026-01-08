import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const ConfigSchema = z.object({
    port: z.coerce.number().default(3000),
    host: z.string().default('0.0.0.0'),
    theme: z.string().default('default'),
    baseFile: z.string().default('README.md'),
    'latex-macros': z.record(z.string(), z.string()).optional(),
});

export type GlintConfig = z.infer<typeof ConfigSchema>;

const DEFAULTS: GlintConfig = {
    port: 3000,
    host: '0.0.0.0',
    theme: 'default',
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
