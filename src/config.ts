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

export const DEFAULTS: GlintConfig = {
    colorScheme: 'nord',
    baseFile: 'README.md',
};
