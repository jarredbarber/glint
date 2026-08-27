/**
 * Available color scheme names for Glint.
 */
export const AVAILABLE_COLOR_SCHEMES = [
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
export interface GlintConfig {
    colorScheme: string;
    baseFile: string;
    'latex-macros'?: Record<string, string>;
}

export function readLatexMacros(frontmatter: Record<string, unknown>): Record<string, string> | undefined {
    const value = frontmatter['latex-macros'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const entries = Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
}

export const DEFAULTS: GlintConfig = {
    colorScheme: 'nord',
    baseFile: 'README.md',
};
