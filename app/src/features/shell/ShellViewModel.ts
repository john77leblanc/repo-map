import { makeAutoObservable } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Workspace } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
export interface ShellDeps {
    repo: RepositoryModel;
    services: Services;
    onWorkspaceChange?: (workspace: Workspace) => void;
    onLayoutChange?: () => void;
}
export class ShellViewModel {
    width = 300;
    collapsed = false;
    dragging = false;
    settingsOpen = false;
    workspace: Workspace = 'architecture';
    private initialized = false;
    constructor(readonly deps: ShellDeps) {
        makeAutoObservable(this, { deps: false }, { autoBind: true });
    }
    init(viewport = 1280) {
        if (this.initialized || !this.deps.repo.ready) return;
        this.initialized = true;
        const saved = this.deps.services.storage.get<{ w?: number; c?: boolean }>(
            this.deps.repo.namespace + 'library',
            {}
        );
        this.width = this.clamp(
            typeof saved.w === 'number' && Number.isFinite(saved.w) ? saved.w : 300,
            viewport
        );
        this.collapsed = !!saved.c;
    }
    private clamp(width: number, viewport: number) {
        return Math.max(
            260,
            Math.min(Math.max(260, Math.min(760, Math.round(viewport * 0.6))), Math.round(width))
        );
    }
    private save() {
        this.deps.services.storage.set(this.deps.repo.namespace + 'library', {
            w: this.width,
            c: this.collapsed,
        });
    }
    setWidth(width: number, viewport = 1280, persist = true) {
        this.width = this.clamp(width, viewport);
        if (persist) this.save();
        this.deps.onLayoutChange?.();
    }
    toggleSidebar() {
        this.collapsed = !this.collapsed;
        this.save();
        this.deps.onLayoutChange?.();
    }
    expandSidebar() {
        if (this.collapsed) this.toggleSidebar();
    }
    startResize() {
        this.dragging = true;
    }
    endResize() {
        if (!this.dragging) return;
        this.dragging = false;
        this.save();
        this.deps.onLayoutChange?.();
    }
    resizeKey(key: string, viewport = 1280) {
        if (key === 'ArrowLeft' || key === 'ArrowRight')
            this.setWidth(this.width + (key === 'ArrowLeft' ? -20 : 20), viewport);
        else if (key === 'Home' || key === 'Enter') this.setWidth(300, viewport);
        else return false;
        return true;
    }
    showWorkspace(workspace: Workspace) {
        this.workspace = workspace;
        this.deps.onWorkspaceChange?.(workspace);
        this.deps.onLayoutChange?.();
    }
    openSettings() {
        this.settingsOpen = true;
    }
    closeSettings() {
        this.settingsOpen = false;
    }
    dispose() {
        this.dragging = false;
    }
}
