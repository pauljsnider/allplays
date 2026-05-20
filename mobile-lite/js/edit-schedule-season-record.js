import { inferSeasonLabelFromGame } from './season-record.js';

export function hydrateSeasonRecordFormFields({ game, fallbackDate } = {}) {
    const resolvedDate = fallbackDate || game?.date;
    return {
        seasonLabel: inferSeasonLabelFromGame({
            seasonLabel: game?.seasonLabel,
            date: resolvedDate
        }),
        competitionType: game?.competitionType || 'league',
        countsTowardSeasonRecord: game?.countsTowardSeasonRecord !== false
    };
}

export function buildSeasonRecordGameFields({
    parsedGameDate,
    seasonLabel,
    competitionType,
    countsTowardSeasonRecord
} = {}) {
    const hydratedFields = hydrateSeasonRecordFormFields({
        game: {
            seasonLabel,
            competitionType,
            countsTowardSeasonRecord
        },
        fallbackDate: parsedGameDate
    });

    return {
        seasonLabel: hydratedFields.seasonLabel,
        competitionType: hydratedFields.competitionType,
        countsTowardSeasonRecord: hydratedFields.countsTowardSeasonRecord
    };
}
