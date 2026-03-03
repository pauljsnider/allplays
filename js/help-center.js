const HELP_ROLE_ALIASES = {
    parent: 'parent',
    parents: 'parent',
    coach: 'coach',
    coaches: 'coach',
    admin: 'administrator',
    admins: 'administrator',
    administrator: 'administrator',
    administrators: 'administrator',
    member: 'member',
    user: 'member'
};

const HELP_SECTIONS = [
    {
        id: 'account-access',
        title: 'Account and Access',
        summary: 'Create an account, sign in, manage profile details, and understand permissions and privacy defaults.',
        keywords: ['onboarding', 'authentication', 'password', 'profile', 'permissions', 'privacy', 'security'],
        roles: ['parent', 'coach', 'administrator', 'member'],
        workflows: [
            'Create account with activation code and complete onboarding',
            'Sign in, sign out, and reset password',
            'Update profile details and notification identity',
            'Understand role permissions and access boundaries'
        ]
    },
    {
        id: 'core-workflows',
        title: 'Core Platform Workflows',
        summary: 'End-to-end steps for creating, updating, archiving, and operating team workflows.',
        keywords: ['setup', 'operations', 'edit', 'delete', 'archive', 'notifications', 'alerts'],
        roles: ['parent', 'coach', 'administrator', 'member'],
        workflows: [
            'Set up teams, schedules, and roster records',
            'Operate game-day and practice workflows',
            'Edit or archive records safely',
            'Review notification and alert behavior'
        ]
    },
    {
        id: 'role-experiences',
        title: 'Role-Based Experiences',
        summary: 'Role-specific visibility, responsibilities, and limits for parents, coaches, and administrators.',
        keywords: ['role', 'visibility', 'responsibilities', 'limits', 'boundaries'],
        roles: ['parent', 'coach', 'administrator', 'member'],
        workflows: [
            'What each role can see and do in navigation and workflows',
            'How roles interact with one another on teams',
            'Common tasks by role and expected outcomes',
            'Boundary conditions and permission denials'
        ]
    },
    {
        id: 'data-reporting',
        title: 'Data and Reporting',
        summary: 'Understand records, metrics definitions, data timing, and export/share patterns.',
        keywords: ['metrics', 'definitions', 'reports', 'records', 'export', 'refresh'],
        roles: ['coach', 'administrator', 'parent'],
        workflows: [
            'View and interpret team and player data',
            'Create or edit records with role-aware permissions',
            'Share or export data where allowed',
            'Understand refresh timing and data consistency'
        ]
    },
    {
        id: 'communication',
        title: 'Communication and Collaboration',
        summary: 'Team chat, notification preferences, moderation behavior, and privacy expectations.',
        keywords: ['chat', 'messages', 'notifications', 'moderation', 'privacy', 'collaboration'],
        roles: ['parent', 'coach', 'administrator'],
        workflows: [
            'Send and receive team communications',
            'Adjust notification preferences for each workflow',
            'Follow moderation and content controls',
            'Handle private data with least-privilege expectations'
        ]
    },
    {
        id: 'settings-config',
        title: 'System Settings and Configuration',
        summary: 'Application, team, and user-level settings with configuration decision guidance.',
        keywords: ['settings', 'configuration', 'organization', 'team settings', 'user settings'],
        roles: ['coach', 'administrator'],
        workflows: [
            'Configure application and team-level settings',
            'Update user-level preferences and defaults',
            'Apply safe changes with rollback awareness',
            'Verify configuration impact before rollout'
        ]
    },
    {
        id: 'troubleshooting',
        title: 'Error Handling and Edge Cases',
        summary: 'Troubleshoot common errors, permission denials, sync delays, and escalation paths.',
        keywords: ['error', 'troubleshoot', 'permission denied', 'sync', 'delays', 'escalation'],
        roles: ['parent', 'coach', 'administrator', 'member'],
        workflows: [
            'Decode common error messages and likely causes',
            'Resolve permission-related issues by role',
            'Handle sync/update delays and stale data',
            'Escalate with logs and reproducible steps'
        ]
    },
    {
        id: 'glossary',
        title: 'Glossary',
        summary: 'Plain-language definitions for common platform terms used across help content.',
        keywords: ['glossary', 'definitions', 'terminology', 'beginner'],
        roles: ['parent', 'coach', 'administrator', 'member'],
        workflows: [
            'Role: access persona tied to permissions',
            'Workflow: complete sequence of tasks from start to finish',
            'Archive: retain record while removing from active operations',
            'Refresh behavior: when visible data updates after writes'
        ]
    }
];

export function normalizeHelpRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    return HELP_ROLE_ALIASES[normalized] || 'member';
}

export function getHelpSectionsForRole(role) {
    const normalizedRole = normalizeHelpRole(role);
    return HELP_SECTIONS.filter((section) => section.roles.includes(normalizedRole));
}

export function searchHelpSections(sections, query) {
    const trimmed = String(query || '').trim().toLowerCase();
    if (!trimmed) return [...sections];

    return sections.filter((section) => {
        const values = [
            section.title,
            section.summary,
            ...(section.keywords || []),
            ...(section.workflows || [])
        ];
        return values.some((value) => String(value).toLowerCase().includes(trimmed));
    });
}
