const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            reportsDirectory: './coverage/unit',
            include: ['js/utils.js'],
        },
    },
});
