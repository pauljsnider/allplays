const DEFAULT_TIMEOUT_MS = 12000;

function compactString(value) {
  return String(value || '').trim();
}

function normalizeProviderKey(value) {
  return compactString(value).toLowerCase().replace(/[\s_]+/g, '-');
}

function isSportsConnectProvider(value) {
  return normalizeProviderKey(value) === 'sports-connect';
}

function getRegistrationSource(team = {}) {
  const source = team.registrationSource && typeof team.registrationSource === 'object' ? team.registrationSource : {};
  const legacyProvider = team.registrationProvider && typeof team.registrationProvider === 'object' ? team.registrationProvider : {};
  return {
    ...legacyProvider,
    ...source
  };
}

function getTeamSportsConnectConfig(team = {}, config = {}) {
  const source = getRegistrationSource(team);
  const provider = compactString(source.provider || source.providerName || source.providerId || team.registrationSourceId);
  const externalTeamId = compactString(
    source.externalTeamId ||
    source.teamId ||
    team.externalRegistrationTeamId ||
    team.registrationExternalTeamId
  );
  const endpointTemplate = compactString(
    config.endpointTemplate ||
    config.registrationSnapshotUrl ||
    config.baseUrl ||
    source.registrationSnapshotUrl ||
    source.syncUrl
  );
  const accessToken = compactString(config.accessToken || config.token);

  return {
    provider,
    providerId: isSportsConnectProvider(provider) ? 'sports-connect' : normalizeProviderKey(provider),
    externalTeamId,
    endpointTemplate,
    accessToken
  };
}

function assertSportsConnectSyncConfig(syncConfig = {}) {
  if (!isSportsConnectProvider(syncConfig.provider)) {
    const error = new Error('Sports Connect must be selected before syncing registration data.');
    error.code = 'failed-precondition';
    throw error;
  }
  if (!syncConfig.externalTeamId) {
    const error = new Error('Add a Sports Connect team ID before syncing registration data.');
    error.code = 'failed-precondition';
    throw error;
  }
  if (!syncConfig.endpointTemplate) {
    const error = new Error('Sports Connect registration sync endpoint is not configured.');
    error.code = 'failed-precondition';
    throw error;
  }
  if (!syncConfig.accessToken) {
    const error = new Error('Sports Connect registration sync credentials are not configured.');
    error.code = 'failed-precondition';
    throw error;
  }
}

function buildSportsConnectRegistrationUrl(endpointTemplate, externalTeamId) {
  const endpoint = compactString(endpointTemplate);
  const encodedTeamId = encodeURIComponent(compactString(externalTeamId));
  if (!endpoint) return '';
  if (endpoint.includes('{externalTeamId}')) {
    return endpoint.replace(/\{externalTeamId\}/g, encodedTeamId);
  }
  if (endpoint.includes('{teamId}')) {
    return endpoint.replace(/\{teamId\}/g, encodedTeamId);
  }

  const parsed = new URL(endpoint);
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/teams/${encodedTeamId}/registration-snapshot`;
  return parsed.toString();
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

async function fetchSportsConnectRegistrationPayload({
  endpointTemplate,
  externalTeamId,
  accessToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    const error = new Error('A fetch implementation is required for Sports Connect sync.');
    error.code = 'internal';
    throw error;
  }
  const url = buildSportsConnectRegistrationUrl(endpointTemplate, externalTeamId);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    const error = new Error('Sports Connect registration sync endpoint must use https.');
    error.code = 'failed-precondition';
    throw error;
  }

  const timeout = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'allplays-sports-connect-sync/1.0'
      },
      signal: timeout.signal
    });
    if (!response?.ok) {
      const errorText = typeof response?.text === 'function'
        ? await response.text().catch(() => '')
        : '';
      const error = new Error(`Sports Connect sync failed with HTTP ${response?.status || 'unknown'}${errorText ? `: ${errorText.slice(0, 160)}` : ''}`);
      error.code = 'unavailable';
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Sports Connect sync timed out.');
      timeoutError.code = 'deadline-exceeded';
      throw timeoutError;
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

function normalizeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getCandidateArray(payload = {}) {
  const source = normalizeRecord(payload);
  const data = normalizeRecord(source.data);
  const candidates = [
    source.players,
    source.rosterPlayers,
    source.roster,
    source.athletes,
    source.registrations,
    data.players,
    data.rosterPlayers,
    data.roster,
    data.athletes,
    data.registrations
  ];
  return candidates.find(Array.isArray) || [];
}

function getName(record = {}) {
  const source = normalizeRecord(record);
  const player = normalizeRecord(source.player);
  const athlete = normalizeRecord(source.athlete);
  const directName = compactString(source.name || source.fullName || source.displayName || source.playerName || source.athleteName);
  if (directName) return directName;
  const firstName = compactString(source.firstName || source.givenName || player.firstName || athlete.firstName);
  const lastName = compactString(source.lastName || source.familyName || player.lastName || athlete.lastName);
  return [firstName, lastName].filter(Boolean).join(' ');
}

function getExternalPlayerId(record = {}) {
  const source = normalizeRecord(record);
  const player = normalizeRecord(source.player);
  const athlete = normalizeRecord(source.athlete);
  return compactString(
    source.externalPlayerId ||
    source.playerId ||
    source.athleteId ||
    source.personId ||
    source.id ||
    player.id ||
    athlete.id ||
    source.registrationId
  );
}

function normalizeContacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((contact) => {
      const source = normalizeRecord(contact);
      return {
        name: compactString(source.name || source.fullName || source.displayName),
        email: compactString(source.email || source.emailAddress).toLowerCase(),
        phone: compactString(source.phone || source.phoneNumber || source.mobilePhone),
        relation: compactString(source.relation || source.relationship || source.type)
      };
    })
    .filter((contact) => contact.name || contact.email || contact.phone || contact.relation);
}

function normalizeSportsConnectPlayer(record = {}) {
  const source = normalizeRecord(record);
  const player = normalizeRecord(source.player);
  const athlete = normalizeRecord(source.athlete);
  const merged = { ...source, ...player, ...athlete };
  const externalPlayerId = getExternalPlayerId(merged);
  const name = getName(merged);
  if (!externalPlayerId || !name) return null;

  const output = {
    externalPlayerId,
    name,
    number: compactString(merged.number || merged.jerseyNumber || merged.jersey || merged.uniformNumber),
    active: merged.active === false ? false : true
  };
  const guardians = normalizeContacts(merged.guardians || merged.parents || merged.familyContacts);
  const contacts = normalizeContacts(merged.contacts || merged.contactFields);
  if (guardians.length) output.guardians = guardians;
  if (contacts.length) output.contacts = contacts;

  const answers = merged.answers || merged.customFields || merged.profileFields || merged.formData || merged.submittedData;
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    output.answers = answers;
  }
  return output;
}

function buildSportsConnectRegistrationSnapshot(payload = {}, { externalTeamId, fetchedAt = new Date().toISOString() } = {}) {
  const source = normalizeRecord(payload);
  const players = getCandidateArray(source)
    .map(normalizeSportsConnectPlayer)
    .filter(Boolean);
  return {
    provider: 'Sports Connect',
    providerId: 'sports-connect',
    sourceType: 'sports-connect',
    sourceId: compactString(source.sourceId || source.id || externalTeamId || 'sports-connect'),
    externalTeamId: compactString(source.externalTeamId || source.teamId || externalTeamId),
    externalTeamName: compactString(source.teamName || source.name || source.externalTeamName),
    fetchedAt,
    rosterPlayers: players,
    players,
    playerCount: players.length
  };
}

function buildSportsConnectTeamUpdate({
  existingSource = {},
  snapshot,
  nowIso = new Date().toISOString()
} = {}) {
  const playerCount = Number(snapshot?.playerCount || snapshot?.players?.length || 0);
  const registrationSource = {
    ...existingSource,
    provider: 'Sports Connect',
    providerId: 'sports-connect',
    externalTeamId: snapshot.externalTeamId,
    teamId: existingSource.teamId || null,
    connectionStatus: 'sync_success',
    syncEnabled: true,
    lastSyncStatus: 'success',
    lastSyncAt: nowIso,
    lastSyncError: null,
    playerCount
  };
  return {
    registrationSource,
    registrationSourceSnapshot: {
      ...snapshot,
      rosterPlayers: snapshot.players
    },
    registrationRosterSnapshot: snapshot
  };
}

function buildSportsConnectSyncErrorUpdate(existingSource = {}, message, nowIso = new Date().toISOString()) {
  return {
    registrationSource: {
      ...existingSource,
      connectionStatus: 'sync_error',
      syncEnabled: true,
      lastSyncStatus: 'error',
      lastSyncAt: nowIso,
      lastSyncError: compactString(message).slice(0, 500) || 'Sports Connect sync failed.'
    }
  };
}

module.exports = {
  buildSportsConnectRegistrationSnapshot,
  buildSportsConnectRegistrationUrl,
  buildSportsConnectSyncErrorUpdate,
  buildSportsConnectTeamUpdate,
  fetchSportsConnectRegistrationPayload,
  getRegistrationSource,
  getTeamSportsConnectConfig,
  isSportsConnectProvider,
  assertSportsConnectSyncConfig
};
