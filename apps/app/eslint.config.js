import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  prettier,
  {
    rules: {
      'no-useless-escape': 'warn'
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2024
      }
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'no-console': 'warn',
      'no-undef': 'off',
      'no-unsafe-optional-chaining': 'warn',
      'no-unsafe-finally': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-catch': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react/no-children-prop': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-expressions': 'warn'
    }
  }
];
