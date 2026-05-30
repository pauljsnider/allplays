module.exports = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: [
    '<rootDir>/src/lib/__tests__/chatService.test.ts'
  ],
  moduleNameMapper: {
    // This will handle the ?v=15 in firebase.js imports
    '^\.\./\.\./\.\./\.\./js/(.*)\?v=\\d+$': '<rootDir>/../../js/$1',
    '^\.\./\.\./\.\./\.\./js/(.*)$': '<rootDir>/../../js/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: './tsconfig.test.json',
    }],
  },
};
