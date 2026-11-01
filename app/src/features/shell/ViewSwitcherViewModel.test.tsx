import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { Trace } from '../../models/types';
import { Application } from '../../bootstrap/Application';
import { MissingView, ViewTabs } from './ViewTabs';

afterEach(cleanup);

function setup(ai = true) {
    const services: Services = {
        api: { get: vi.fn(() => new Promise(() => {})), request: vi.fn(() => new Promise(() => {})), stream: vi.fn(() => new Promise(() => {})) },
        storage: { get: <T,>(_key: string, fallback: T) => fallback, set: vi.fn(), getRaw: () => null, setRaw: vi.fn() },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
    } as unknown as Services;
    const repo = new RepositoryModel(services);
    repo.bootstrap = {
        config: { name: 'Test', columns: [{ title: 'Code' }] },
        repo: {},
        ai: { available: ai, label: ai ? 'Test AI' : '' },
    };
    repo.map = {
        groups: [{ id: 'a', col: 0, title: 'Alpha', open: true }],
        nodes: [{ id: 'one', title: 'One', group: 'a', kind: 'service' }],
        edges: [],
    };
    const app = new Application(repo, services);
    const trace = (extra: Partial<Trace> = {}): Trace => ({
        intent: 'description', title: 'Checkout', prompt: '', summary: '', gaps: '',
        steps: [{ id: 'one', note: '' }], edges: [], refs: [],
        outputs: { architecture: true, flowchart: false }, pendingFlow: false, ...extra,
    });
    return { app, repo, views: app.views, trace };
}

describe('ViewSwitcherViewModel', () => {
    it('lists four views for the map, with Flowchart, a missing sitemap and missing components marked', () => {
        const { views } = setup();
        expect(views.views.map((v) => [v.id, v.exists])).toEqual([['architecture', true], ['flowchart', false], ['sitemap', false], ['components', false]]);
        expect(views.context).toBe('Map');
        expect(views.showMissing).toBe(false);
        views.show('flowchart');
        expect(views.showMissing).toBe(true);
        expect(views.missing.title).toBe('Flowcharts only exist for traces');
        expect(views.missing.action.label).toBe('New trace');
    });
    it('offers Generate for a missing map view, disabled without an AI tool', () => {
        const { views, app } = setup(false);
        runInAction(() => { app.repo.map.nodes = []; });
        expect(views.missing.title).toBe("The architecture view doesn't exist for this map");
        expect(views.missing.action).toMatchObject({ label: 'Generate', disabled: true, title: 'Set up an AI tool in Settings first' });
    });
    it('a trace keeps the current view, shows its missing message, and Back from Flowchart returns to the last map view', () => {
        const { views, app, trace } = setup();
        app.views.show('sitemap');
        app.traces.select(trace());
        expect(app.shell.workspace).toBe('sitemap');
        expect(views.context).toBe('Trace · Checkout');
        expect(views.missing.title).toBe("The sitemap view doesn't exist for this trace");
        expect(views.missing.hint).toBe('The repository sitemap is needed first.');
        views.show('flowchart');
        expect(views.missing.title).toBe("The flowchart view doesn't exist for this trace");
        views.missing.action.run();
        expect(app.flowchart.busy).toBe(true);
        expect(views.showMissing).toBe(false);
        app.flowchart.stop();
        app.traces.clear();
        expect(app.shell.workspace).toBe('sitemap');
        views.show('architecture');
        app.traces.select(trace());
        views.show('flowchart');
        app.traces.clear();
        expect(app.shell.workspace).toBe('architecture');
    });
    it('marks a busy view and shows its workspace instead of the message', () => {
        const { views, app, trace } = setup();
        app.traces.select(trace(), 'flowchart');
        expect(views.showMissing).toBe(true);
        runInAction(() => { app.flowchart.busy = true; });
        expect(views.views.find((v) => v.id === 'flowchart')?.busy).toBe(true);
        expect(views.showMissing).toBe(false);
    });
});

describe('Components view', () => {
    it('asks for the sitemap first, then offers Generate', () => {
        const { views, app } = setup();
        views.show('components');
        expect(app.shell.workspace).toBe('components');
        // loading counts as busy: no message yet (the test API never answers)
        expect(views.showMissing).toBe(false);
        runInAction(() => { app.components.loading = false; });
        expect(views.showMissing).toBe(true);
        expect(views.missing.title).toBe("The components view doesn't exist for this map");
        expect(views.missing.hint).toBe('Generate the sitemap first: components are mapped from its screens.');
        runInAction(() => {
            app.sitemap.sitemap = { version: 1, applicability: 'applicable', summary: '', gaps: [], applications: [{ id: 'a', label: 'A' }],
                screens: [{ id: 's', app: 'a', label: 'S', route: '', detail: '', refs: [] }], navigation: [] };
        });
        expect(views.missing.hint).toBe('Components are mapped from the sitemap’s screens.');
        views.missing.action.run();
        expect(app.components.busy).toBe(true);
        expect(views.showMissing).toBe(false);
        app.components.stop();
    });
    it('is a trace output: a trace without it asks for the map, then offers to draw it', () => {
        const { views, app, trace } = setup();
        views.show('components');
        app.traces.select(trace(), 'components');
        expect(views.views.map((v) => v.id)).toEqual(['architecture', 'flowchart', 'sitemap', 'components']);
        expect(app.shell.workspace).toBe('components');
        expect(views.showMissing).toBe(true);
        expect(views.missing.title).toBe("The components view doesn't exist for this trace");
        expect(views.missing.hint).toBe('The repository component map is needed first, and it is mapped from the sitemap’s screens.');
        runInAction(() => {
            app.components.components = { version: 1, applicability: 'applicable', summary: 'x', gaps: [],
                components: [{ id: 'page', label: 'Page', detail: '', tags: [], refs: [] }], uses: [], screens: [] };
        });
        expect(views.missing.hint).toBeUndefined();
        expect(views.missing.action.label).toBe('Generate');
        app.traces.clear();
        expect(app.shell.workspace).toBe('components');
    });
    it('Used in opens the screen on the Sitemap view; the Sitemap opens components in this view', () => {
        const { app } = setup();
        runInAction(() => {
            app.sitemap.sitemap = { version: 1, applicability: 'applicable', summary: '', gaps: [], applications: [{ id: 'a', label: 'A' }],
                screens: [{ id: 's', app: 'a', label: 'S', route: '', detail: '', refs: [] }], navigation: [] };
            app.components.components = { version: 1, applicability: 'applicable', summary: 'x', gaps: [],
                components: [{ id: 'page', label: 'Page', detail: '', tags: [], refs: [] }], uses: [], screens: [{ screen: 's', root: 'page' }] };
        });
        app.views.show('components');
        app.components.openScreen('s');
        expect(app.shell.workspace).toBe('sitemap');
        expect(app.sitemap.selectedId).toBe('s');
        expect(app.sitemap.rootComponents('s').map((c) => c.id)).toEqual(['page']);
        app.sitemap.showComponent('s', 'page');
        expect(app.shell.workspace).toBe('components');
        expect(app.components.graph.scope).toBe('s');
        expect(app.components.graph.selectedId).toBe('page');
    });
});

describe('ViewTabs', () => {
    it('switches views with arrow keys and marks missing tabs', () => {
        const { views } = setup();
        render(<><ViewTabs vm={views} />{views.showMissing && <MissingView vm={views} />}</>);
        const architecture = screen.getByRole('tab', { name: 'Architecture' });
        expect(architecture).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Flowchart' })).toHaveClass('missing');
        act(() => { fireEvent.keyDown(architecture, { key: 'ArrowRight' }); });
        expect(views.current).toBe('flowchart');
        expect(screen.getByRole('tab', { name: 'Flowchart' })).toHaveFocus();
        act(() => { fireEvent.keyDown(screen.getByRole('tab', { name: 'Flowchart' }), { key: 'End' }); });
        expect(views.current).toBe('components');
        expect(screen.getByText('Map')).toHaveClass('view-context');
    });
    it('renders the missing message with its action', () => {
        const { views, app } = setup();
        views.show('flowchart');
        render(<MissingView vm={views} />);
        expect(screen.getByRole('heading', { name: 'Flowcharts only exist for traces' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'New trace' }));
        expect(app.traces.composerOpen).toBe(true);
    });
});
