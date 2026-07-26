import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.{js,mjs,ts}'],
    rules: {},
  },
];
