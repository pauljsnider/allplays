import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import AccessTool from './parent-tools/AccessTool';
import * as parentToolLoaders from './parent-tools/loaders';
import {
    LoadingBlock,
    accessDependentToolIds,
    initialToolRefreshVersions,
    tools,
    type ParentToolId,
    validParentToolIds
} from './parent-tools/shared';

declare global {
    var __ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__: ((toolId: ParentToolId) => void) | undefined;
}

const HouseholdInviteTool = lazy(parentToolLoaders.loadParentToolsHouseholdPanelModule);
const FeesTool = lazy(parentToolLoaders.loadParentToolsFeesPanelModule);
const CalendarTool = lazy(parentToolLoaders.loadParentToolsCalendarPanelModule);
const FamilyShareTool = lazy(parentToolLoaders.loadParentToolsSharePanelModule);
const RegistrationsTool = lazy(parentToolLoaders.loadParentToolsRegistrationsPanelModule);
const CertificatesTool = lazy(parentToolLoaders.loadParentToolsCertificatesPanelModule);

function trackParentToolRender(toolId: ParentToolId) {
    globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__?.(toolId);
}

const MemoizedAccessTool = memo(function MemoizedAccessTool(props: { auth: AuthState; onAccessChanged: () => void }) {
    trackParentToolRender('access');
    return <AccessTool {...props} />;
});

const MemoizedHouseholdInviteTool = memo(function MemoizedHouseholdInviteTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('household');
    return <HouseholdInviteTool {...props} />;
});

const MemoizedFeesTool = memo(function MemoizedFeesTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('fees');
    return <FeesTool {...props} />;
});

const MemoizedCalendarTool = memo(function MemoizedCalendarTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('calendar');
    return <CalendarTool {...props} />;
});

const MemoizedFamilyShareTool = memo(function MemoizedFamilyShareTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('share');
    return <FamilyShareTool {...props} />;
});

const MemoizedRegistrationsTool = memo(function MemoizedRegistrationsTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('registrations');
    return <RegistrationsTool {...props} />;
});

const MemoizedCertificatesTool = memo(function MemoizedCertificatesTool(props: { auth: AuthState; refreshVersion: number }) {
    trackParentToolRender('certificates');
    return <CertificatesTool {...props} />;
});

export function ParentTools({ auth }: { auth: AuthState }) {
    const { toolId = 'access' } = useParams();
    const navigate = useNavigate();
    const activeTool = validParentToolIds.has(toolId as ParentToolId) ? toolId as ParentToolId : null;
    const [visitedTools, setVisitedTools] = useState<ParentToolId[]>(() => activeTool ? [activeTool] : ['access']);
    const [toolRefreshVersions, setToolRefreshVersions] = useState<Record<ParentToolId, number>>(initialToolRefreshVersions);
    const [staleTools, setStaleTools] = useState<Set<ParentToolId>>(() => new Set());
    const activeToolRef = useRef<ParentToolId | null>(activeTool);
    const visitedToolsRef = useRef<ParentToolId[]>(visitedTools);
    const staleToolsRef = useRef(staleTools);

    useEffect(() => {
        activeToolRef.current = activeTool;
    }, [activeTool]);

    useEffect(() => {
        visitedToolsRef.current = visitedTools;
    }, [visitedTools]);

    useEffect(() => {
        staleToolsRef.current = staleTools;
    }, [staleTools]);

    useEffect(() => {
        if (!activeTool) return;
        setVisitedTools((current) => (current.includes(activeTool) ? current : [...current, activeTool]));

        if (!staleToolsRef.current.has(activeTool)) return;

        setStaleTools((current) => {
            if (!current.has(activeTool)) return current;
            const next = new Set(current);
            next.delete(activeTool);
            return next;
        });
        setToolRefreshVersions((current) => ({
            ...current,
            [activeTool]: current[activeTool] + 1
        }));
    }, [activeTool]);

    const setTool = useCallback((nextTool: ParentToolId) => {
        navigate(`/parent-tools/${nextTool}`);
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }, [navigate]);

    const handleAccessChanged = useCallback(() => {
        const currentActiveTool = activeToolRef.current;
        const currentVisitedTools = visitedToolsRef.current;

        setToolRefreshVersions((current) => currentActiveTool && currentActiveTool !== 'access' && accessDependentToolIds.includes(currentActiveTool) ? {
            ...current,
            [currentActiveTool]: current[currentActiveTool] + 1
        } : current);
        setStaleTools(() => new Set(accessDependentToolIds.filter((id) => id !== currentActiveTool && currentVisitedTools.includes(id))));
    }, []);

    if (!activeTool) return <Navigate to="/parent-tools/access" replace />;

    return (
        <div className="parent-tools-page space-y-3">
            <section className="app-card overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <Link to="/home" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to Home" title="Back to Home">
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <div className="app-label">Parent tools</div>
                        <h1 className="truncate text-xl font-black leading-tight text-gray-950">Family workflows</h1>
                        <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">Access, household invites, payments, calendars, sharing, registration, and awards.</p>
                    </div>
                </div>
            </section>

            <div className="parent-tools-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
                <div className="grid min-w-max grid-cols-7 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
                    {tools.map((tool) => {
                        const Icon = tool.icon;
                        const active = tool.id === activeTool;
                        return (
                            <button
                                key={tool.id}
                                type="button"
                                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-black transition sm:text-sm ${active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
                                onClick={() => setTool(tool.id)}
                                aria-pressed={active}
                            >
                                <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                                <span>{tool.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <KeepAliveTool active={activeTool === 'access'} mounted={visitedTools.includes('access')}><MemoizedAccessTool auth={auth} onAccessChanged={handleAccessChanged} /></KeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'household'} mounted={visitedTools.includes('household')} label="Loading household invites"><MemoizedHouseholdInviteTool auth={auth} refreshVersion={toolRefreshVersions.household} /></LazyKeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'fees'} mounted={visitedTools.includes('fees')} label="Loading fees"><MemoizedFeesTool auth={auth} refreshVersion={toolRefreshVersions.fees} /></LazyKeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'calendar'} mounted={visitedTools.includes('calendar')} label="Loading calendar tools"><MemoizedCalendarTool auth={auth} refreshVersion={toolRefreshVersions.calendar} /></LazyKeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'share'} mounted={visitedTools.includes('share')} label="Loading share links"><MemoizedFamilyShareTool auth={auth} refreshVersion={toolRefreshVersions.share} /></LazyKeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'registrations'} mounted={visitedTools.includes('registrations')} label="Loading registrations"><MemoizedRegistrationsTool auth={auth} refreshVersion={toolRefreshVersions.registrations} /></LazyKeepAliveTool>
            <LazyKeepAliveTool active={activeTool === 'certificates'} mounted={visitedTools.includes('certificates')} label="Loading awards"><MemoizedCertificatesTool auth={auth} refreshVersion={toolRefreshVersions.certificates} /></LazyKeepAliveTool>
        </div>
    );
}

function KeepAliveTool({ active, mounted, children }: { active: boolean; mounted: boolean; children: ReactNode }) {
    if (!mounted) return null;
    return <div hidden={!active}>{children}</div>;
}

function LazyKeepAliveTool({ active, mounted, label, children }: { active: boolean; mounted: boolean; label: string; children: ReactNode }) {
    if (!mounted) return null;
    return (
        <div hidden={!active}>
            <Suspense fallback={<LoadingBlock label={label} />}>
                {children}
            </Suspense>
        </div>
    );
}
