import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.{js,mjs,ts}'],
    rules: {
      /*
       * Honour the leading-underscore convention.
       *
       * These files are the first `.mjs` in the repo to be linted at all —
       * web-astro's config matches only .ts/.tsx/.js/.jsx/.astro, so the
       * telemetry modules were never checked while they lived there. Turning
       * linting on found the convention was assumed and never configured.
       *
       * It earns its keep on a stub like `alert()`, where the parameters are
       * the documented contract and the empty body is deliberate until Wave 2.
       */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
