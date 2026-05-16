/* OrbitCode — Canonical Starter Templates
 *
 * Known-good file templates for common project setups.
 * These are injected into the implement stage prompt so the agent can
 * COPY them verbatim instead of relying on model memory (which mixes
 * Tailwind v3/v4 patterns and produces broken configs).
 *
 * Each template is a map of filename → file content.
 */

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

// ════════════════════════════════════════════
//  OrbitCode starter tokens shared across templates
// ════════════════════════════════════════════

const ORBIT_THEME_CSS = `/* OrbitCode Starter Tokens - Tailwind v4 @theme directive */
@import "tailwindcss";

@theme {
  /* Primary */
  --color-orbit-mint: #7CDA9B;
  --color-orbit-mint-hover: #65C985;
  --color-orbit-mint-active: #4EAD6B;
  --color-orbit-sky: #72D6F3;

  /* Dark / Navigation */
  --color-orbit-ink: #15181D;
  --color-orbit-panel: #1C2128;

  /* Secondary */
  --color-orbit-amber: #FFD166;

  /* Semantic */
  --color-orbit-success: #7CDA9B;
  --color-orbit-warning: #FFD166;
  --color-orbit-error: #FF6B6B;
  --color-orbit-info: #72D6F3;

  /* Backgrounds */
  --color-orbit-canvas: #F7F5EF;
  --color-orbit-card: #FFFFFF;

  /* Typography */
  --font-inter: 'Inter', sans-serif;
  --font-inter-tight: 'Inter Tight', sans-serif;

  /* Border radius */
  --radius-badge: 4px;
  --radius-input: 8px;
  --radius-card: 12px;
  --radius-panel: 16px;
}

/* Base styles */
body {
  font-family: var(--font-inter);
  background-color: var(--color-orbit-canvas);
  margin: 0;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-inter-tight);
}
`;

const GOOGLE_FONTS_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap" rel="stylesheet">';

// ════════════════════════════════════════════
//  React + Vite + Tailwind v4 Template
// ════════════════════════════════════════════

export const REACT_VITE_TAILWIND_TEMPLATE: StarterTemplate = {
  id: 'react-vite-tw4',
  name: 'React + Vite + Tailwind v4',
  description: 'Known-good starter for React + Vite with Tailwind CSS v4 and a neutral OrbitCode starter theme',
  files: {
    'postcss.config.js': `export default {
  plugins: {
    '@tailwindcss/postcss': {},
    'autoprefixer': {},
  },
}
`,
    'src/index.css': ORBIT_THEME_CSS,

    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${GOOGLE_FONTS_LINK}
    <title>OrbitCode App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
    'src/main.jsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
  },
};

// ════════════════════════════════════════════
//  Template prompt generation
// ════════════════════════════════════════════

/**
 * Generates the canonical starter template section for the implement prompt.
 * This gives the agent exact file contents to use instead of guessing.
 */
export function getStarterTemplatePrompt(): string {
  const t = REACT_VITE_TAILWIND_TEMPLATE;
  const fileBlocks = Object.entries(t.files).map(([filename, content]) =>
    `### ${filename}\n\`\`\`\n${content.trim()}\n\`\`\``
  ).join('\n\n');

  return [
    '## CANONICAL STARTER TEMPLATE: React + Vite + Tailwind v4',
    '',
    '**When creating a React + Vite + Tailwind project, use these EXACT file contents.**',
    'Do NOT deviate from these patterns. Do NOT create a tailwind.config.js for custom colors.',
    'In Tailwind v4, custom theme tokens are defined via `@theme {}` in the CSS file, NOT in tailwind.config.js.',
    '',
    '**Required npm packages:**',
    '```',
    'npm create vite@latest . -- --template react',
    'npm install',
    'npm install -D @tailwindcss/postcss postcss autoprefixer',
    '```',
    '',
    '**IMPORTANT: Do NOT install `tailwindcss` as a separate package. The `@tailwindcss/postcss` package includes it.**',
    '',
    fileBlocks,
    '',
    '### Using custom OrbitCode starter colors in components:',
    'After defining the @theme tokens above, use them as Tailwind classes:',
    '- `bg-orbit-mint` for primary actions',
    '- `bg-orbit-ink` for dark navigation',
    '- `text-orbit-mint` for emphasis',
    '- `bg-orbit-canvas` for page backgrounds',
    '- `bg-orbit-success`, `bg-orbit-warning`, and `bg-orbit-error` for states',
    '- `rounded-card` → 12px border radius',
    '- `rounded-input` → 8px border radius',
    '- `font-inter` / `font-inter-tight` → typography',
    '',
    '### Branding:',
    '- Do not add corporate logos unless the user explicitly provides one.',
    '- Prefer text, icons, CSS, or user-provided image assets for branding.',
    '',
    '### CRITICAL — What NOT to do:',
    '- Do NOT create a `tailwind.config.js` with `extend.colors` — Tailwind v4 ignores it for @theme tokens',
    '- Do NOT use `@tailwind base; @tailwind components; @tailwind utilities` — use `@import "tailwindcss"`',
    '- Do NOT install `tailwindcss` as a PostCSS plugin directly — use `@tailwindcss/postcss`',
    '- Do NOT use camelCase color names like `orbitMint` — use kebab-case `orbit-mint` (matching the @theme variable names)',
    '- Do NOT create PNG/JPG files via create_file. Use real image assets or SVG/text-based icons where appropriate.',
  ].join('\n');
}

/**
 * Returns the raw OrbitCode starter theme CSS content for direct file creation.
 */
export function getOrbitThemeCSS(): string {
  return ORBIT_THEME_CSS;
}

export function getUnopsThemeCSS(): string {
  return ORBIT_THEME_CSS;
}

/**
 * Returns the Google Fonts link tag for HTML templates.
 */
export function getGoogleFontsLink(): string {
  return GOOGLE_FONTS_LINK;
}
