/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './public/index.html',
    './public/scripts/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{ts,tsx}',
    './content/**/*.{md,mdx}',
  ],
  safelist: [
    'lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)]',
    'xl:grid-cols-[minmax(0,192px)_minmax(0,1fr)]',
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
