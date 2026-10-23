import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CodeReference } from './CodeReference';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../services/contracts';

it('loads new references when a selected step reuses the same view', async () => {
    const get = vi.fn(async (url: string) => ({
        lines: [url.includes('first') ? 'first source' : 'second source'],
        start: 1,
        end: 1,
        total: 1,
    }));
    const repo = new RepositoryModel({
        api: { get },
        storage: {},
        browser: {},
    } as unknown as Services);
    const { rerender, container } = render(
        <CodeReference reference={{ path: 'first.ts', start: 1, end: 1 }} repo={repo} />
    );
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await screen.findByText('first source');
    rerender(<CodeReference reference={{ path: 'second.ts', start: 1, end: 1 }} repo={repo} />);
    await screen.findByText('second source');
    expect(screen.queryByText('first source')).toBeNull();
});

it('renders documentation labels declaratively and retries failed file reads', async () => {
    const get = vi
        .fn()
        .mockRejectedValueOnce(new Error('moved'))
        .mockResolvedValue({ lines: ['guide'], start: 1, end: 1 });
    const repo = new RepositoryModel({
        api: { get },
        storage: {},
        browser: {},
    } as unknown as Services);
    const { container } = render(
        <CodeReference
            documentation
            reference={{ path: 'AGENTS.md', start: 1, end: 1, kind: 'guide', title: 'Agent rules' }}
            repo={repo}
        />
    );
    expect(screen.getByText('Agent guide')).toBeVisible();
    expect(screen.getByText('Agent rules')).toBeVisible();
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await screen.findByText(/Couldn't read/);
    details.open = false;
    fireEvent(details, new Event('toggle'));
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(screen.getByText('guide')).toBeVisible());
});
