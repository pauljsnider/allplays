import { normalizeStatTrackerConfig } from './stat-leaderboards.js?v=1';

const PRESET_DEFINITIONS = [
    {
        id: 'blank',
        label: 'Blank Slate',
        description: 'Start with an empty schema and build it yourself.',
        config: {
            name: 'Custom Stat Schema',
            baseType: 'Custom',
            columns: [],
            statDefinitions: []
        }
    },
    {
        id: 'basketball',
        label: 'Basketball Standard',
        description: 'Points, rebounds, assists, shooting efficiency, and turnover ratio.',
        config: {
            name: 'Basketball Standard',
            baseType: 'Basketball',
            columns: ['PTS', 'REB', 'AST', 'FGM', 'FGA', 'TO'],
            statDefinitions: [
                { label: 'PTS', acronym: 'PTS', group: 'Offense', topStat: true },
                { label: 'REB', acronym: 'REB', group: 'Rebounding', topStat: true },
                { label: 'AST', acronym: 'AST', group: 'Offense', topStat: true },
                { label: 'FGM', acronym: 'FGM', group: 'Offense' },
                { label: 'FGA', acronym: 'FGA', group: 'Offense' },
                { label: 'TO', acronym: 'TO', group: 'Offense', rankingOrder: 'asc' },
                { id: 'fieldgoalpct', label: 'FG%', acronym: 'FG%', formula: '(FGM/FGA)*100', group: 'Offense', format: 'percentage', precision: 1, topStat: true },
                { id: 'asttoratio', label: 'AST/TO', acronym: 'AST/TO', formula: 'AST/TO', group: 'Offense', precision: 2, topStat: true }
            ]
        }
    },
    {
        id: 'soccer',
        label: 'Soccer Standard',
        description: 'Goals, shots, finishing, assists, and goalkeeper saves.',
        config: {
            name: 'Soccer Standard',
            baseType: 'Soccer',
            columns: ['GOALS', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS', 'SAVES'],
            statDefinitions: [
                { label: 'GOALS', acronym: 'GOALS', group: 'Attack', topStat: true },
                { label: 'SHOTS', acronym: 'SHOTS', group: 'Attack' },
                { label: 'SHOTS_ON_TARGET', acronym: 'SHOTS_ON_TARGET', group: 'Attack', topStat: true },
                { label: 'ASSISTS', acronym: 'ASSISTS', group: 'Attack', topStat: true },
                { label: 'SAVES', acronym: 'SAVES', group: 'Goalkeeping', topStat: true },
                { id: 'shotpct', label: 'Shot%', acronym: 'Shot%', formula: '(SHOTS_ON_TARGET/SHOTS)*100', group: 'Attack', format: 'percentage', precision: 1, topStat: true },
                { id: 'goalrate', label: 'Goal Rate', acronym: 'Goal Rate', formula: '(GOALS/SHOTS)*100', group: 'Attack', format: 'percentage', precision: 1, topStat: true }
            ]
        }
    },
    {
        id: 'baseball',
        label: 'Baseball Standard',
        description: 'Core hitting, pitching, and fielding stats.',
        config: {
            name: 'Baseball Standard',
            baseType: 'Baseball',
            columns: ['R', 'H', 'RBI', 'SB', 'SO'],
            statDefinitions: [
                { label: 'R', acronym: 'R', group: 'Batting', topStat: true },
                { label: 'H', acronym: 'H', group: 'Batting', topStat: true },
                { label: 'RBI', acronym: 'RBI', group: 'Batting', topStat: true },
                { label: 'SB', acronym: 'SB', group: 'Base Running', topStat: true },
                { label: 'SO', acronym: 'SO', group: 'Pitching', rankingOrder: 'asc' }
            ]
        }
    },
    {
        id: 'football',
        label: 'Football Standard',
        description: 'Touchdowns, yards, tackles, sacks, and turnovers.',
        config: {
            name: 'Football Standard',
            baseType: 'Football',
            columns: ['TD', 'YDS', 'TACK', 'SACK', 'TO'],
            statDefinitions: [
                { label: 'TD', acronym: 'TD', group: 'Scoring', topStat: true },
                { label: 'YDS', acronym: 'YDS', group: 'Offense', topStat: true },
                { label: 'TACK', acronym: 'TACK', group: 'Defense', topStat: true },
                { label: 'SACK', acronym: 'SACK', group: 'Defense', topStat: true },
                { label: 'TO', acronym: 'TO', group: 'Defense', topStat: true }
            ]
        }
    },
    {
        id: 'volleyball',
        label: 'Volleyball Standard',
        description: 'Kills, assists, digs, aces, and blocks.',
        config: {
            name: 'Volleyball Standard',
            baseType: 'Volleyball',
            columns: ['KILLS', 'AST', 'DIGS', 'ACES', 'BLKS'],
            statDefinitions: [
                { label: 'KILLS', acronym: 'KILLS', group: 'Attack', topStat: true },
                { label: 'AST', acronym: 'AST', group: 'Setting', topStat: true },
                { label: 'DIGS', acronym: 'DIGS', group: 'Defense', topStat: true },
                { label: 'ACES', acronym: 'ACES', group: 'Serving', topStat: true },
                { label: 'BLKS', acronym: 'BLKS', group: 'Defense', topStat: true }
            ]
        }
    }
];

function cloneConfig(config = {}) {
    return JSON.parse(JSON.stringify(config));
}

function getBaseDefinitionMap(columns = []) {
    const normalized = normalizeStatTrackerConfig({ columns });
    return new Map((normalized.statDefinitions || []).map((definition) => [definition.id, definition]));
}

function serializeDefinition(definition = {}, baseDefinition = null) {
    const attributes = [];
    const addIfChanged = (key, value, fallbackValue, transform = (input) => input) => {
        if (value === undefined || value === null || value === '') return;
        const normalizedValue = transform(value);
        const normalizedFallback = transform(fallbackValue);
        if (normalizedValue === normalizedFallback) return;
        attributes.push(`${key}=${value}`);
    };

    if (definition.formula) {
        attributes.push(`formula=${definition.formula}`);
    }

    addIfChanged('group', definition.group, baseDefinition?.group || 'General');
    addIfChanged('scope', definition.scope, baseDefinition?.scope || 'player');
    addIfChanged('visibility', definition.visibility, baseDefinition?.visibility || 'public');
    addIfChanged('format', definition.format, definition.formula ? 'number' : (baseDefinition?.format || 'number'));
    if (definition.formula && definition.precision !== undefined && definition.precision !== null && definition.precision !== '') {
        attributes.push(`precision=${definition.precision}`);
    } else {
        addIfChanged('precision', definition.precision, baseDefinition?.precision ?? 0, (value) => Number(value));
    }
    addIfChanged('rankingOrder', definition.rankingOrder, baseDefinition?.rankingOrder || 'desc');
    addIfChanged('topStat', definition.topStat, baseDefinition?.topStat || false, (value) => value === true);

    return `${definition.label || definition.acronym || definition.id}=${definition.id}${attributes.length ? `|${attributes.join('|')}` : ''}`;
}

export function getStatConfigPresetOptions() {
    return PRESET_DEFINITIONS.map(({ id, label, description, config }) => ({
        id,
        label,
        description,
        baseType: config.baseType
    }));
}

export function getStatConfigPresetById(presetId) {
    const preset = PRESET_DEFINITIONS.find((entry) => entry.id === presetId);
    return preset ? normalizeStatTrackerConfig(cloneConfig(preset.config)) : null;
}

export function getDefaultStatConfigForSport(sport = '') {
    const normalizedSport = String(sport || '').trim().toLowerCase();
    const preset = PRESET_DEFINITIONS.find((entry) => String(entry.config.baseType || '').trim().toLowerCase() === normalizedSport);
    return preset ? normalizeStatTrackerConfig(cloneConfig(preset.config)) : null;
}

export function serializeAdvancedStatDefinitions(config = {}) {
    const normalized = normalizeStatTrackerConfig(config);
    const baseDefinitionMap = getBaseDefinitionMap(normalized.columns || []);

    return (normalized.statDefinitions || [])
        .filter((definition) => {
            const baseDefinition = baseDefinitionMap.get(definition.id);
            if (!baseDefinition) return true;
            if (definition.formula) return true;
            return [
                definition.group !== baseDefinition.group,
                definition.scope !== baseDefinition.scope,
                definition.visibility !== baseDefinition.visibility,
                definition.format !== baseDefinition.format,
                Number(definition.precision) !== Number(baseDefinition.precision),
                definition.rankingOrder !== baseDefinition.rankingOrder,
                Boolean(definition.topStat) !== Boolean(baseDefinition.topStat),
                definition.label !== baseDefinition.label,
                definition.acronym !== baseDefinition.acronym
            ].some(Boolean);
        })
        .map((definition) => serializeDefinition(definition, baseDefinitionMap.get(definition.id) || null))
        .join('\n');
}
