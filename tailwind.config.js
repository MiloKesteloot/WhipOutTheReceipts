/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // hover: only on devices with a mouse. On phones a hover style sticks to
  // whatever was last tapped (a removed chip looking half selected, a row
  // staying gray), so taps get active: styles for feedback instead.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        // Accent color — controlled by CSS variables in src/index.css.
        // Use accent-50 through accent-700 anywhere in JSX (500 included).
        accent: {
          50:  'rgb(var(--accent-50)  / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
