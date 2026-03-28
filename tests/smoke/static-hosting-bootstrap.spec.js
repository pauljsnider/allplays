import { test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

test('homepage boots under static-hosting constraints', async ({ page, baseURL }) => {
    await assertPageBootsWithoutFatalErrors(page, {
        baseURL,
        path: '/',
        titlePatterns: /ALL PLAYS/i
    });
});

test('dashboard boot path does not fatally fail under static-hosting constraints', async ({ page, baseURL }) => {
    await assertPageBootsWithoutFatalErrors(page, {
        baseURL,
        path: '/dashboard.html',
        titlePatterns: [/My Teams/i, /Login - ALL PLAYS/i]
    });
});
