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

function getCandidateArray(payload = {}) {
  const candidates = [
    payload.players,
    payload.rosterPlayers,
    payload.roster,
    payload.athletes,
    payload.registrations,
    payload.data?.players,
    payload.data?.rosterPlayers,
    payload.data?.roster,
    payload.data?.athletes,
    payload.data?.registrations
  ];
  return candidates.find(Array.isArray) || [];
}

function getName(record = {}) {
  const directName = compactString(record.name || record.fullName || record.displayName || record.playerName || record.athleteName);
  if (directName) return directName;
  const firstName = compactString(record.firstName || record.givenName || record.player?.firstName || record.athlete?.firstName);
  const lastName = compactString(record.lastName || record.familyName || record.player?.lastName || record.athlete?.lastName);
  return [firstName, lastName].filter(Boolean).join(' ');
}

function getExternalPlayerId(record = {}) {
  return compactString(
    record.externalPlayerId ||
    record.playerId ||
    record.athleteId ||
    record.personId ||
    record.id ||
    record.player?.id ||
    record.athlete?.id ||
    record.registrationId
  );
}

function normalizeContacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((contact) => ({
      name: compactString(contact.name || contact.fullName || contact.displayName),
      email: compactString(contact.email || contact.emailAddress).toLowerCase(),
      phone: compactString(contact.phone || contact.phoneNumber || contact.mobilePhone),
      relation: compactString(contact.relation || contact.relationship || contact.type)
    }))
    .filter((contact) => contact.name || contact.email || contact.phone || contact.relation);
}

function normalizeSportsConnectPlayer(record = {}) {
  const player = record.player && typeof record.player === 'object' ? record.player : {};
  const athlete = record.athlete && typeof record.athlete === 'object' ? record.athlete : {};
  const merged = { ...record, ...player, ...athlete };
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
  const players = getCandidateArray(payload)
    .map(normalizeSportsConnectPlayer)
    .filter(Boolean);
  return {
    provider: 'Sports Connect',
    providerId: 'sports-connect',
    sourceType: 'sports-connect',
    sourceId: compactString(payload.sourceId || payload.id || externalTeamId || 'sports-connect'),
    externalTeamId: compactString(payload.externalTeamId || payload.teamId || externalTeamId),
    externalTeamName: compactString(payload.teamName || payload.name || payload.externalTeamName),
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
