/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Chatgram brand (mirrors the Flutter palette)
        brand: {
          50: '#e6f4f1',
          100: '#c2e5dd',
          200: '#9ad4c8',
          300: '#6ec2b1',
          400: '#4bb49f',
          500: '#26a68e',
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
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(.22,.9,.28,1) both',
        'fade-in': 'fade-in .35s ease both',
        'slide-in': 'slide-in .3s ease both',
        'pop-in': 'pop-in .25s cubic-bezier(.22,.9,.28,1) both',
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
