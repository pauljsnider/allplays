import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShellSource = readFileSync(new URL('../../apps/app/src/components/AppShell.tsx', import.meta.url), 'utf8');

describe('AppSearchDialog lazy-load guards', () => {
    it('does not statically import AppSearchDialog at the top of AppShell', () => {
        // A static ESM import would look like: import { AppSearchDialog } from './AppSearchDialog'
        // or: import AppSearchDialog from './AppSearchDialog'
        expect(appShellSource).not.toMatch(/^import\s+.*AppSearchDialog.*from\s+['"]\.\/AppSearchDialog['"]/m);
    });

    it('loads AppSearchDialog through React.lazy with a dynamic import', () => {
        // Should use lazy() wrapping a dynamic import() for AppSearchDialog
        expect(appShellSource).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]\.\/AppSearchDialog['"]\s*\)/);
    });

    it('wraps the lazy AppSearchDialog in a Suspense boundary with a null fallback', () => {
        expect(appShellSource).toContain('<Suspense fallback={null}>');
        expect(appShellSource).toContain('AppSearchDialog');
    });

    it('imports Suspense and lazy from react', () => {
        expect(appShellSource).toMatch(/import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*['"]react['"]/);
        expect(appShellSource).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*['"]react['"]/);
    });
});
