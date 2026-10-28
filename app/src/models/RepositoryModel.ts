import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { Bootstrap, CodeRef, RepoMap } from './types';
import type { Services } from '../shared/services/contracts';
import { ReferenceViewerModel } from './ReferenceViewerModel';

export class RepositoryModel {
    bootstrap: Bootstrap | null = null;
    map: RepoMap = { nodes: [], edges: [], groups: [] };
    docs: Record<string, CodeRef[]> = {};
    ready = false;
    error = '';
    /** The code reference modal, opened from any reference row. */
    readonly references: ReferenceViewerModel;
    constructor(readonly services: Services) {
        this.references = new ReferenceViewerModel(this);
        makeAutoObservable(
            this,
            { services: false, references: false, bootstrap: observableRef, map: observableRef },
            { autoBind: true }
        );
    }
    get namespace() {
        return (
            'repomap:' + (this.bootstrap?.repo.github || this.bootstrap?.config.name || '') + ':'
        );
    }
    get aiAvailable() {
        return !!this.bootstrap?.ai.available;
    }
    setAiAvailable(value: boolean) {
        if (this.bootstrap)
            this.bootstrap = { ...this.bootstrap, ai: { ...this.bootstrap.ai, available: value } };
    }
    async load() {
        try {
            const [bootstrap, map] = await Promise.all([
                this.services.api.get<Bootstrap>('/api/config'),
                this.services.api.get<RepoMap & { docs?: Record<string, CodeRef[]> }>('/api/map'),
            ]);
            runInAction(() => {
                this.bootstrap = bootstrap;
                this.map = map;
                this.docs = map.docs || {};
                this.ready = true;
                this.error = '';
            });
        } catch (error) {
            runInAction(() => {
                this.error = error instanceof Error ? error.message : String(error);
            });
        }
    }
}
