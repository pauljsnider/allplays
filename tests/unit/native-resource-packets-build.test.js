import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
describe('packaged assignment rollout', () => {
  for (const workflow of ['mobile-release', 'mobile-build']) {
    it(`${workflow} passes the shared opt-in to both native asset builds`, () => {
      const source = parse(readFileSync(`.github/workflows/${workflow}.yml`, 'utf8'));
      const jobs = Object.values(source.jobs).filter(job => job.steps?.some(step => (step.run?.includes('npm run mobile:sync') || step.run?.includes('npm run app:build:native'))));
      expect(jobs).toHaveLength(2);
      for (const job of jobs) {
        const step = job.steps.find(step => (step.run?.includes('npm run mobile:sync') || step.run?.includes('npm run app:build:native')));
        expect(step.env.VITE_RESOURCE_PACKETS_ENABLED).toBe('${{ vars.RESOURCE_PACKETS_ENABLED }}');
      }
    });
  }
});
