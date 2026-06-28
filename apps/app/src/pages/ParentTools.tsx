import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Award, CalendarDays, ChevronLeft, DollarSign, Loader2, Share2, Shield, Ticket, Users, type LucideIcon } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import { loadParentToolPanel } from './parent-tools/loadParentToolPanel';
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';

type ParentToolDefinition = { id: ParentToolId; label: string; icon: LucideIcon };
type ParentToolsRedirectState = { accessLockedMessage?: string };

export type ParentToolId = 'access' | 'household' | 'fees' | 'calendar' | 'share' | 'registrations' | 'certificates';
export type ParentToolPanelProps = { auth: AuthState; refreshVersion: number; onAccessChanged: () => void };

declare global {
    var __ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__: ((toolId: ParentToolId) => void) | undefined;
}

const tools: ParentToolDefinition[] = [
    { id: 'access', label: 'Access', icon: Shield },
    { id: 'household', label: 'Household', icon: Users },
    { id: 'fees', label: 'Fees', icon: DollarSign },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'share', label: 'Share', icon: Share2 },
    { id: 'registrations', label: 'Register', icon: Ticket },
    { id: 'certificates', label: 'Awards', icon: Award }
];

const validToolIds = new Set(tools.map((tool) => tool.id));
const accessDependentToolIds = tools.map((tool) => tool.id).filter((id): id is ParentToolId => id !== 'access');
const initialToolRefreshVersions = Object.fromEntries(tools.map((tool) => [tool.id, 0])) as Record<ParentToolId, number>;
const lazyToolPanels = Object.fromEntries(
    tools.map((tool) => [tool.id, lazy(() => loadParentToolPanel(tool.id))])
) as Record<ParentToolId, LazyExoticComponent<ComponentType<ParentToolPanelProps>>>;

function trackParentToolRender(toolId: ParentToolId) {
    completeParentCoreWorkflowTimer(toolId === 'fees' ? 'fees' : 'parent_tools', {
        targetPage: toolId === 'fees' ? 'fees' : 'parent_tools',
        toolId,
        completedRoute: `/parent-tools/${toolId}`
    });
    globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__?.(toolId);
}

function hasParentToolLinks(auth: AuthState) {
    return Boolean(
        auth.user?.parentOf?.length ||
        auth.user?.parentPlayerKeys?.length ||
        auth.user?.parentTeamIds?.length
    );
}

const ParentToolPanel = memo(function ParentToolPanel({ toolId, auth, refreshVersion, onAccessChanged }: { toolId: ParentToolId } & ParentToolPanelProps) {
    trackParentToolRender(toolId);
    const Panel = lazyToolPanels[toolId];
    return <Panel auth={auth} refreshVersion={refreshVersion} onAccessChanged={onAccessChanged} />;
});

export function ParentTools({ auth }: { auth: AuthState }) {
    const { toolId = 'access' } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const activeTool = validToolIds.has(toolId as ParentToolId) ? toolId as ParentToolId : null;
    const hasLinkedPlayers = hasParentToolLinks(auth);
    const visibleTools = hasLinkedPlayers ? tools : tools.filter((tool) => tool.id === 'access');
    const visibleToolIds = new Set(visibleTools.map((tool) => tool.id));
    const isLockedDeepLink = Boolean(activeTool && !visibleToolIds.has(activeTool));
    const redirectState = location.state as ParentToolsRedirectState | null;
    const accessLockedMessage = activeTool === 'access' ? redirectState?.accessLockedMessage : undefined;
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
    if (isLockedDeepLink) {
        return <Navigate to="/parent-tools/access" replace state={{ accessLockedMessage: 'Link a player in Access to unlock the rest of Parent Tools.' }} />;
    }

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
                        <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{hasLinkedPlayers ? 'Access, household invites, payments, calendars, sharing, registration, and awards.' : 'Start with Access. Link a player to unlock the rest of Parent Tools.'}</p>
                    </div>
                </div>
            </section>

            {accessLockedMessage ? (
                <section className="app-card border border-amber-200 bg-amber-50/80 p-4 text-sm font-semibold text-amber-900">
                    {accessLockedMessage}
                </section>
            ) : null}

            <div className="parent-tools-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
                <div className="grid min-w-max gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm" style={{ gridTemplateColumns: `repeat(${visibleTools.length}, minmax(0, 1fr))` }}>
                    {visibleTools.map((tool) => {
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

            {visibleTools.map((tool) => (
                <KeepAliveTool key={tool.id} active={activeTool === tool.id} mounted={visitedTools.includes(tool.id)}>
                    <Suspense fallback={<ParentToolPanelFallback />}>
                        <ParentToolPanel
                            toolId={tool.id}
                            auth={auth}
                            refreshVersion={toolRefreshVersions[tool.id]}
                            onAccessChanged={handleAccessChanged}
                        />
                    </Suspense>
                </KeepAliveTool>
            ))}
        </div>
    );
}

function KeepAliveTool({ active, mounted, children }: { active: boolean; mounted: boolean; children: ReactNode }) {
    if (!mounted) return null;
    return <div hidden={!active}>{children}</div>;
}

function ParentToolPanelFallback() {
    return (
        <section className="app-card p-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
            <div className="mt-3 text-sm font-black text-gray-900">Loading parent tool</div>
        </section>
    );
}
