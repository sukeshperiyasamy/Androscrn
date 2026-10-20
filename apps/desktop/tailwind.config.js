/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic Theme Palette
        theme: {
          bg: '#FFFFFF',
          secondary: '#F3F6F8',
          surface: '#FFFFFF',
          text: '#202936',
          'text-secondary': '#667085',
          'text-muted': '#84909E',
          primary: '#0F766E',
          'primary-hover': '#115E59',
          'primary-subtle': '#DDF4EF',
          border: '#D9DEE5',
          success: '#15803D',
          'success-bg': '#DCFCE7',
          warning: '#B45309',
          'warning-bg': '#FEF3C7',
          danger: '#B91C1C',
          'danger-bg': '#FEE2E2',
          info: '#1D4ED8',
          'info-bg': '#DBEAFE',
        },
        // Coordinated Slate Palette (Light Theme Defaults)
        slate: {
          50: '#111827',
          100: '#202936', // Charcoal primary text
          200: '#202936', // Charcoal body text
          300: '#667085', // Secondary text
          400: '#84909E', // Muted text
          500: '#84909E',
          600: '#84909E',
          700: '#D9DEE5', // Border / Divider
          800: '#D9DEE5', // Border / Divider
          900: '#F3F6F8', // Secondary Background
          950: '#FFFFFF', // Clean White Primary Background
        },
        // Deep Teal Accent mapping
        teal: {
          50: '#F0FDF4',
          100: '#DDF4EF', // Pale Mint
          200: '#B2E5DC',
          500: '#0F766E',
          600: '#0F766E', // Deep Teal
          700: '#115E59', // Primary Hover
          800: '#0F5B54',
          900: '#134E48',
        },
        // Remap generic AI Indigo to Deep Teal
        indigo: {
          50: '#DDF4EF',
          100: '#DDF4EF',
          200: '#0F766E',
          300: '#0F766E',
          400: '#0F766E',
          500: '#0F766E',
          600: '#0F766E', // Deep Teal
          700: '#115E59', // Deep Teal Hover
          800: '#0F5B54',
          900: '#F3F6F8',
          950: '#FFFFFF',
        },
        // Remap Cyan to Deep Teal Coordinated Accents
        cyan: {
          50: '#DDF4EF',
          100: '#DDF4EF',
          200: '#0F766E',
          300: '#0F766E',
          400: '#0F766E',
          500: '#0F766E',
          600: '#115E59',
          700: '#0F5B54',
          800: '#134E48',
          900: '#F3F6F8',
        }
      }
    }
  },
  plugins: []
};
