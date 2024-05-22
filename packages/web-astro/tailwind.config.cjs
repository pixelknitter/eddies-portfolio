const {
  createGlobPatternsForDependencies,
} = require('@nxtensions/astro/tailwind');
const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(
      __dirname,
      'src/**/!(*.stories|*.spec).{astro,html,js,jsx,md,svelte,ts,tsx,vue}'
    ),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {
      colors: {
        background: '#1e1e2e',
        'background-light': '#fdebf3',
        'border-light': '#fdebf3',
        button: '#5dd39e',
        text: '#fdebf3',
        'text-light': '#1e1e2e',
        'text-link': '#5dd39e',
        underline: '#348aa7',
        emphasis: '#525174',
        tag: '#584966',
        disabled: '#5c5b77',
      },
      fontFamily: {
        header: ['Pacifico', 'cursive'],
        body: ['Josefin Sans', 'sans-serif'],
      },
      textUnderlineOffset: {
        6: '6px',
      },
      textDecorationThickness: {
        4: '4px',
      },
    },
  },
  darkMode: 'class',
  plugins: [require('@tailwindcss/typography')],
};
