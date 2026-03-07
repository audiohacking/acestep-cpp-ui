import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './data/**/*.{ts,tsx}',
    './i18n/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        suno: {
          DEFAULT: '#09090b',
          sidebar: '#000000',
          panel: '#121214',
          card: '#18181b',
          hover: '#27272a',
          border: '#27272a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      animation: {
        'gradient-x': 'gradient-x 15s ease infinite',
      },
      keyframes: {
        'gradient-x': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          },
        },
      }
    }
  },
  plugins: [],
} satisfies Config;
