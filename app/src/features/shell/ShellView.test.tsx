import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { ShellViewModel } from './ShellViewModel';
import { ShellView } from './ShellView';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
function fixture() {
    const services: Services = {
        api: { get: vi.fn(), request: vi.fn(), stream: vi.fn() },
        storage: {
            get: (_key, fallback) => fallback,
            set: vi.fn(),
            getRaw: () => null,
            setRaw: vi.fn(),
        },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
    };
    const repo = new RepositoryModel(services);
    repo.ready = true;
    repo.bootstrap = {
        config: { name: 'shop', columns: [] },
        repo: {},
        ai: { available: true, label: 'AI' },
    };
    return { repo, services };
}
describe('shell', () => {
    it('uses legacy library key and clamps keyboard widths', () => {
        const f = fixture(),
            vm = new ShellViewModel(f);
        vm.init();
        vm.setWidth(900, 1000);
        expect(vm.width).toBe(600);
        vm.resizeKey('Home');
        expect(vm.width).toBe(360);
        vm.toggleSidebar();
        expect(f.services.storage.set).toHaveBeenLastCalledWith('repomap:shop:library', {
            w: 360,
            c: true,
        });
        vm.dispose();
    });
    it('opens Settings on a section, and on Map when the map needs attention', () => {
        const onOpenSettings = vi.fn();
        const vm = new ShellViewModel({ ...fixture(), onOpenSettings });
        vm.openSettings('agents');
        expect(onOpenSettings).toHaveBeenCalledWith('agents');
        expect(vm.settingsOpen).toBe(true);
        vm.closeSettings();
        render(
            <ShellView vm={vm} selectedTrace={false} needsAttention onBack={vi.fn()} sidebar={null} settings={null}>
                <div />
            </ShellView>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Settings: map needs attention' }));
        expect(onOpenSettings).toHaveBeenLastCalledWith('map');
        expect(vm.settingsOpen).toBe(true);
        cleanup();
    });
    it('composes slots and switches settings/back controls for selected traces', () => {
        const vm = new ShellViewModel(fixture()),
            back = vi.fn();
        const view = render(
            <ShellView
                vm={vm}
                selectedTrace={false}
                onBack={back}
                sidebar={<div>Library slot</div>}
                settings={<div>Settings slot</div>}
            >
                <div>Main slot</div>
            </ShellView>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(vm.settingsOpen).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
        expect(vm.collapsed).toBe(true);
        // Collapsed, the expand button is the only control left in the bar.
        expect([...view.container.querySelectorAll('.side-bar button:not([hidden])')].map((b) => b.id)).toEqual(['side-toggle']);
        const boundary = screen
            .getByText('Library slot')
            .closest('[data-sidebar-content]') as HTMLElement;
        expect(boundary.hidden).toBe(true);
        expect(boundary.style.display).toBe('none');
        fireEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
        expect(boundary.hidden).toBe(false);
        expect(boundary.style.display).toBe('contents');
        view.rerender(
            <ShellView vm={vm} selectedTrace onBack={back} sidebar={<div>Library slot</div>}>
                Main slot
            </ShellView>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Back to all traces' }));
        expect(back).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
        cleanup();
        vm.dispose();
    });
});
