import { describe, expect, it } from 'vitest';
import {
    collectVersionedModuleImports,
    findStaleVersionedModuleImports,
    resolveVersionedModulePath
} from '../../scripts/cache-bust-graph.mjs';

describe('transitive browser cache graph guard', () => {
    it('resolves root-page and nested-module imports to repository module paths', () => {
        expect(resolveVersionedModulePath('team.html', './js/team-access.js')).toBe('js/team-access.js');
        expect(resolveVersionedModulePath('js/certificates/studio.js', '../db.js')).toBe('js/db.js');
        expect(resolveVersionedModulePath('js/auth.js', 'firebase/auth')).toBeNull();
    });

    it('detects unchanged and mixed consumer keys for changed wrapper modules', () => {
        const previousImports = collectVersionedModuleImports([
            { path: 'team.html', source: "import './js/team-admin-banner.js?v=4';" },
            { path: 'game.html', source: "import './js/team-admin-banner.js?v=4';" }
        ]);
        const unchangedImports = collectVersionedModuleImports([
            { path: 'team.html', source: "import './js/team-admin-banner.js?v=4';" },
            { path: 'game.html', source: "import './js/team-admin-banner.js?v=4';" }
        ]);
        const mixedImports = collectVersionedModuleImports([
            { path: 'team.html', source: "import './js/team-admin-banner.js?v=5';" },
            { path: 'game.html', source: "import './js/team-admin-banner.js?v=4';" }
        ]);

        expect(findStaleVersionedModuleImports({
            changedFiles: new Set(['js/team-admin-banner.js']),
            previousImports,
            currentImports: unchangedImports
        })).toMatchObject([{ reason: 'version-not-increased' }]);
        expect(findStaleVersionedModuleImports({
            changedFiles: new Set(['js/team-admin-banner.js']),
            previousImports,
            currentImports: mixedImports
        })).toMatchObject([{ reason: 'mixed-current-versions' }]);
    });

    it('accepts a fresh uniform key and ignores modules with no deployed versioned consumer', () => {
        const previousImports = collectVersionedModuleImports([
            { path: 'team.html', source: "import './js/team-access.js?v=7';" }
        ]);
        const currentImports = collectVersionedModuleImports([
            { path: 'team.html', source: "import './js/team-access.js?v=8';" }
        ]);

        expect(findStaleVersionedModuleImports({
            changedFiles: new Set(['js/team-access.js', 'js/new-helper.js']),
            previousImports,
            currentImports
        })).toEqual([]);
    });
});
