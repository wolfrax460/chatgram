/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e6f4f1',
          100: '#c2e5dd',
          200: '#9ad4c8',
          300: '#6ec2b1',
          400: '#4bb49f',
          500: '#2de2a6',
          600: '#008069',
          700: '#066353',
          800: '#0a4c41',
          900: '#0b3a33',
        },
        ink: {
          50: '#f7f9fa',
          100: '#e9edef',
          200: '#d1d7db',
          300: '#aebac1',
          400: '#8696a0',
          500: '#667781',
          600: '#3b4a54',
          700: '#202c33',
          800: '#111b21',
          900: '#0b141a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.22,.9,.28,1) both',
        'pop-in': 'pop-in .2s cubic-bezier(.22,.9,.28,1) both',
      },
    },
  },
  plugins: [],
};
