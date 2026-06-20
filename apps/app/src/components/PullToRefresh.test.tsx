// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from './PullToRefresh';

describe('PullToRefresh', () => {
  it('merges custom layout classes onto the root container', () => {
    const { container } = render(
      <PullToRefresh className="h-full min-h-0" onRefresh={vi.fn()}>
        <div>Child</div>
      </PullToRefresh>
    );

    const root = container.firstElementChild;
    expect(root?.className).toContain('pull-to-refresh-root');
    expect(root?.className).toContain('h-full');
    expect(root?.className).toContain('min-h-0');
  });
});
