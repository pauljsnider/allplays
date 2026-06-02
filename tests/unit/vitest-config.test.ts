import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.ts';

describe('root vitest config', () => {
    it('dedupes shared React dependencies for app tests', () => {
        expect(vitestConfig.resolve?.dedupe).toEqual(
            expect.arrayContaining(['react', 'react-dom', 'react-router-dom'])
        );
    });
});
