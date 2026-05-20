/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81'
        }
      },
      boxShadow: {
        app: '0 10px 24px rgba(16, 24, 40, 0.07)',
        'app-lg': '0 18px 40px rgba(16, 24, 40, 0.12)'
      }
    }
  },
  plugins: []
};
