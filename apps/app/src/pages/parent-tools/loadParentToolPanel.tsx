import type { ComponentType } from 'react';
import type { ParentToolId, ParentToolPanelProps } from '../ParentTools';

type ParentToolPanelModule = { default: ComponentType<ParentToolPanelProps> };

declare global {
    var __ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__: ((toolId: ParentToolId) => void) | undefined;
}

function trackParentToolPanelLoad(toolId: ParentToolId) {
    globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__?.(toolId);
}

export async function loadParentToolPanel(toolId: ParentToolId): Promise<ParentToolPanelModule> {
    trackParentToolPanelLoad(toolId);

    const panels = await import('./panels');

    switch (toolId) {
        case 'access':
            return {
                default: ({ auth, onAccessChanged }) => <panels.AccessTool auth={auth} onAccessChanged={onAccessChanged} />
            };
        case 'household':
            return {
                default: ({ auth, refreshVersion }) => <panels.HouseholdInviteTool auth={auth} refreshVersion={refreshVersion} />
            };
        case 'fees':
            return {
                default: ({ auth, refreshVersion }) => <panels.FeesTool auth={auth} refreshVersion={refreshVersion} />
            };
        case 'calendar':
            return {
                default: ({ auth, refreshVersion }) => <panels.CalendarTool auth={auth} refreshVersion={refreshVersion} />
            };
        case 'share':
            return {
                default: ({ auth, refreshVersion }) => <panels.FamilyShareTool auth={auth} refreshVersion={refreshVersion} />
            };
        case 'registrations':
            return {
                default: ({ auth, refreshVersion }) => <panels.RegistrationsTool auth={auth} refreshVersion={refreshVersion} />
            };
        case 'certificates':
            return {
                default: ({ auth, refreshVersion }) => <panels.CertificatesTool auth={auth} refreshVersion={refreshVersion} />
            };
        default:
            throw new Error(`Unsupported Parent Tool panel: ${toolId}`);
    }
}
