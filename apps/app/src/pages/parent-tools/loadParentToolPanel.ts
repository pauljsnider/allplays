import type { ComponentType } from 'react';
import type { ParentToolId, ParentToolPanelProps } from '../ParentTools';

declare global {
    var __ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__: ((toolId: ParentToolId) => void) | undefined;
}

function trackParentToolPanelLoad(toolId: ParentToolId) {
    globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__?.(toolId);
}

export function loadParentToolPanel(toolId: ParentToolId): Promise<{ default: ComponentType<ParentToolPanelProps> }> {
    trackParentToolPanelLoad(toolId);

    switch (toolId) {
        case 'access':
            return import('./AccessTool').then((module) => ({ default: module.AccessTool }));
        case 'household':
            return import('./HouseholdInviteTool').then((module) => ({ default: module.HouseholdInviteTool }));
        case 'fees':
            return import('./FeesTool').then((module) => ({ default: module.FeesTool }));
        case 'calendar':
            return import('./CalendarTool').then((module) => ({ default: module.CalendarTool }));
        case 'share':
            return import('./FamilyShareTool').then((module) => ({ default: module.FamilyShareTool }));
        case 'registrations':
            return import('./RegistrationsTool').then((module) => ({ default: module.RegistrationsTool }));
        case 'certificates':
            return import('./CertificatesTool').then((module) => ({ default: module.CertificatesTool }));
    }
}
