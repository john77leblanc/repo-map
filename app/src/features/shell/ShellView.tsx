import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ShellViewModel } from './ShellViewModel';
export interface ShellViewProps {
    vm: ShellViewModel;
    children?: ReactNode;
    main?: ReactNode;
    sidebar: ReactNode;
    settings?: ReactNode;
    selectedTrace: boolean;
    onBack: () => void;
    needsAttention?: boolean;
}
export const ShellView = observer(function ShellView({
    vm,
    children,
    main,
    sidebar,
    settings,
    selectedTrace,
    onBack,
    needsAttention = false,
}: ShellViewProps) {
    const app = useRef<HTMLDivElement>(null);
    useEffect(() => {
        vm.init(window.innerWidth);
        const resize = () => vm.setWidth(vm.width, window.innerWidth, false);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [vm, vm.deps.repo.ready]);
    useEffect(() => {
        document.body.classList.toggle('dragging', vm.dragging);
        return () => document.body.classList.remove('dragging');
    }, [vm.dragging]);
    const settingsLabel = needsAttention ? 'Settings: map needs attention' : 'Settings';
    return (
        <>
            <div
                ref={app}
                className={'app' + (vm.collapsed ? ' collapsed' : '')}
                style={{ '--side-w': vm.width + 'px' } as CSSProperties}
            >
                <main
                    style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
                    className={'main' + (vm.workspace === 'flowchart' ? ' showing-flow' : '')}
                >
                    {main ?? children}
                </main>
                <aside className="side" aria-label="Repository library" id="side">
                    <div
                        className="resizer"
                        id="resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize library"
                        tabIndex={0}
                        title="Drag to resize · double-click to reset"
                        aria-valuemin={312}
                        aria-valuemax={760}
                        aria-valuenow={vm.width}
                        onPointerDown={(e) => {
                            vm.startResize();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            e.preventDefault();
                        }}
                        onPointerMove={(e) => {
                            if (vm.dragging)
                                vm.setWidth(
                                    e.clientX - (app.current?.getBoundingClientRect().left || 0),
                                    window.innerWidth,
                                    false
                                );
                        }}
                        onPointerUp={vm.endResize}
                        onPointerCancel={vm.endResize}
                        onLostPointerCapture={vm.endResize}
                        onDoubleClick={() => vm.setWidth(360, window.innerWidth)}
                        onKeyDown={(e) => {
                            if (vm.resizeKey(e.key, window.innerWidth)) e.preventDefault();
                        }}
                    />
                    <div className="side-in">
                        <div className="side-bar">
                            <button
                                className="btn"
                                id="tab-map"
                                type="button"
                                hidden={selectedTrace || vm.collapsed}
                                aria-label={settingsLabel}
                                title={settingsLabel}
                                onClick={() => vm.openSettings(needsAttention ? 'map' : undefined)}
                            >
                                Settings
                                <span
                                    className="settings-notice"
                                    id="tab-map-dot"
                                    hidden={!needsAttention}
                                    aria-hidden="true"
                                >
                                    <svg viewBox="0 0 16 16">
                                        <path d="M3 11h10l-1.5-2V6a3.5 3.5 0 0 0-7 0v3L3 11zm3.5 2h3" />
                                    </svg>
                                </span>
                            </button>
                            <button
                                className="btn"
                                id="trace-back"
                                type="button"
                                hidden={!selectedTrace || vm.collapsed}
                                onClick={onBack}
                            >
                                Back to all traces
                            </button>
                            <button
                                className="iconbtn"
                                id="side-toggle"
                                type="button"
                                aria-expanded={!vm.collapsed}
                                aria-controls="side"
                                title={vm.collapsed ? 'Expand panel' : 'Collapse panel'}
                                aria-label={vm.collapsed ? 'Expand panel' : 'Collapse panel'}
                                onClick={vm.toggleSidebar}
                            >
                                <svg viewBox="0 0 16 16">
                                    <path d="M10 3.5L5.5 8l4.5 4.5" />
                                </svg>
                            </button>
                        </div>
                        <div
                            hidden={vm.collapsed}
                            style={{ display: vm.collapsed ? 'none' : 'contents' }}
                            data-sidebar-content
                        >
                            {sidebar}
                        </div>
                    </div>
                </aside>
            </div>
            {settings}
        </>
    );
});
