import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeReference } from './CodeReference';
import { ReferenceModal } from './ReferenceModal';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../services/contracts';
import type { CodeRef } from '../../models/types';

const lines = (start: number, end: number, tag: string) =>
    ({ start, end, total: 100, lines: Array.from({ length: end - start + 1 }, (_, i) => `${tag} ${start + i}`) });
const repoWith = (get: ReturnType<typeof vi.fn>, copy = vi.fn(async () => {})) =>
    new RepositoryModel({ api: { get }, storage: {}, browser: { copy } } as unknown as Services);

afterEach(() => vi.useRealTimers());

it('opens the reference in a modal with context lines, the cited ones highlighted', async () => {
    const get = vi.fn(async (url: string) => {
        const q = new URL(url, 'http://x').searchParams;
        return lines(+q.get('start')!, +q.get('end')!, q.get('path')!);
    });
    const repo = repoWith(get);
    const ref: CodeRef = { path: 'src/first.ts', start: 10, end: 12, why: 'Checks the cart.' };
    const { container } = render(<>
        <CodeReference reference={ref} repo={repo} />
        <ReferenceModal vm={repo.references} />
    </>);
    expect(container.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /first\.ts/ }));
    await screen.findByText('src/first.ts 10');
    // five lines of context either side
    expect(get).toHaveBeenCalledWith(expect.stringContaining('start=5&end=17'), expect.anything());
    const cited = [...container.querySelectorAll('#ref-dialog .cl2.cited .ln')].map((n) => n.textContent);
    expect(cited).toEqual(['10', '11', '12']);
    expect(container.querySelectorAll('#ref-dialog .cl2')).toHaveLength(13);
    expect(screen.getByText('Checks the cart.')).toBeTruthy();
    expect(container.querySelector('#ref-prev')).toBeNull();
    fireEvent.click(container.querySelector('#ref-close')!);
    expect(repo.references.isOpen).toBe(false);
});

it('steps through the list with Prev and Next', async () => {
    const get = vi.fn(async (url: string) => lines(1, 3, new URL(url, 'http://x').searchParams.get('path')!));
    const repo = repoWith(get);
    const list: CodeRef[] = [{ path: 'a.ts', start: 1, end: 1 }, { path: 'b.ts', start: 1, end: 1 }];
    const { container } = render(<>
        {list.map((r, i) => <CodeReference key={i} reference={r} repo={repo} list={list} index={i} />)}
        <ReferenceModal vm={repo.references} />
    </>);
    fireEvent.click(screen.getByRole('button', { name: /b\.ts/ }));
    await screen.findByText('b.ts 1');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(container.querySelector<HTMLButtonElement>('#ref-next')!.disabled).toBe(true);
    fireEvent.click(container.querySelector('#ref-prev')!);
    await screen.findByText('a.ts 1');
    expect(screen.queryByText('b.ts 1')).toBeNull();
});

it('copies the path with Copied! feedback, and retries a failed read', async () => {
    const get = vi.fn()
        .mockRejectedValueOnce(new Error('moved'))
        .mockResolvedValue({ lines: ['guide'], start: 1, end: 1 });
    const copy = vi.fn(async () => {});
    const repo = repoWith(get, copy);
    const { container } = render(<>
        <CodeReference documentation repo={repo}
            reference={{ path: 'AGENTS.md', start: 1, end: 4, kind: 'guide', title: 'Agent rules' }} />
        <ReferenceModal vm={repo.references} />
    </>);
    expect(screen.getByText('Agent guide')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Agent rules/ }));
    await screen.findByText(/Couldn't read/);
    expect(container.querySelector('#ref-title')?.textContent).toBe('Agent rules');
    fireEvent.click(container.querySelector('#ref-dialog .ref-note button')!);
    await waitFor(() => expect(screen.getByText('guide')).toBeTruthy());
    vi.useFakeTimers();
    await act(async () => fireEvent.click(container.querySelector('#ref-copy')!));
    expect(copy).toHaveBeenCalledWith('AGENTS.md#L1-L4');
    expect(container.querySelector('#ref-copy')?.getAttribute('data-tip')).toBe('Copied!');
    expect(container.querySelector('#ref-copy')?.textContent).toBe('AGENTS.md#L1-L4');
    act(() => vi.advanceTimersByTime(2000));
    expect(container.querySelector('#ref-copy')?.getAttribute('data-tip')).toBe('Copy path');
});
