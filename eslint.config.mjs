import nx from '@nx/eslint-plugin';
import astro from 'eslint-plugin-astro';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// ESLint 9 flat config for the workspace. Replaces the legacy `.eslintrc.json`
// hierarchy removed during the Nx 23 upgrade.
export default [
  {
    ignores: [
      '**/dist',
      '**/.astro',
      '**/.nx',
      '**/node_modules',
      '**/vitest.config.mts',
    ],
  },

  // Nx base rules (module boundaries plugin registration, TS/JS setup).
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],

  // Enforce Nx module boundaries on all source files.
  {
    files: ['**/*.{ts,tsx,js,jsx,astro}'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
          ],
        },
      ],
    },
  },

  // React islands (.jsx/.tsx). These plugin versions predate flat-config
  // exports, so register them manually against their rule maps.
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // Astro/JSX runtime does not need React in scope, and props are typed
      // with TypeScript rather than prop-types.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Astro components (brings the astro parser + recommended rules).
  ...astro.configs['flat/recommended'],

  // Astro's generated ambient types file uses triple-slash references.
  {
    files: ['**/env.d.ts'],
    rules: { '@typescript-eslint/triple-slash-reference': 'off' },
  },

  // Cypress e2e specs run under the Cypress + Mocha globals.
  {
    files: ['packages/web-astro-e2e/**/*.{ts,js}'],
    languageOptions: {
      globals: {
        cy: 'readonly',
        Cypress: 'readonly',
        describe: 'readonly',
        context: 'readonly',
        it: 'readonly',
        before: 'readonly',
        beforeEach: 'readonly',
        after: 'readonly',
        afterEach: 'readonly',
        expect: 'readonly',
      },
    },
  },
];
