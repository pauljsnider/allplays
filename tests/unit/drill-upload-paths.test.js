import { describe, it, expect } from 'vitest';
import { buildDrillDiagramUploadPaths } from '../../js/drill-upload-paths.js';

describe('drill upload paths', () => {
    it('builds drill diagram image and fallback paths with sanitized values', () => {
        const paths = buildDrillDiagramUploadPaths('team/alpha 01', 'my drill (v1).png', 1700000000000);

        expect(paths.imagePath).toBe('drill-diagrams/team_alpha_01/1700000000000_my_drill_v1_.png');
        expect(paths.fallbackPath).toBe('stat-sheets/1700000000000_drill_team_alpha_01_my_drill_v1_.png');
    });

    it('uses defaults when drill id or file name are missing', () => {
        const paths = buildDrillDiagramUploadPaths('', '', 1700000000001);

        expect(paths.imagePath).toBe('drill-diagrams/unknown/1700000000001_diagram');
        expect(paths.fallbackPath).toBe('stat-sheets/1700000000001_drill_unknown_diagram');
    });
});
