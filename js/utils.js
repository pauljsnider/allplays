export function getUrlParams() {
  // Combine params from both search (?) and hash (#)
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.substring(1));

  const params = {};
  for (const [key, value] of searchParams) params[key] = value;
  for (const [key, value] of hashParams) params[key] = value;

  return params;
}

export function setUrlParams(params) {
  const searchParams = new URLSearchParams(params);
  window.location.hash = searchParams.toString();
}

export function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString();
}

export function formatShortDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export async function shareOrCopy({ title = '', text = '', url = '', clipboardText = '' }) {
  const shareText = clipboardText || `${text}\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return { status: 'shared' };
    } catch (err) {
      if (err && err.name === 'AbortError') return { status: 'aborted' };
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
      return { status: 'copied' };
    } catch (err) {
      return { status: 'failed' };
    }
  }
  return { status: 'failed' };
}

export function renderHeader(container, user) {
  container.innerHTML = `
      <header class="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-50 border-b border-gray-200">
        <nav class="container mx-auto px-4 py-4">
          <div class="flex items-center justify-between">
            <a href="index.html" class="flex items-center space-x-3 hover:opacity-80 transition">
              <div class="w-10 h-10 rounded-lg overflow-hidden border border-gray-200">
                <img src="img/logo_small.png" alt="ALL PLAYS" class="w-full h-full object-cover">
              </div>
              <div>
                <h1 class="text-xl md:text-2xl font-bold bg-gradient-to-r from-primary-600 to-primary-800 bg-clip-text text-transparent">ALL PLAYS</h1>
                <p class="text-xs text-gray-500 hidden sm:block">Modern Team Management</p>
              </div>
            </a>

            <!-- Desktop Nav -->
            <div class="hidden md:flex items-center gap-4" id="nav-auth-actions-desktop">
              <a href="teams.html" class="text-sm font-medium text-gray-600 hover:text-primary-600 transition">Browse Teams</a>
              <a id="nav-my-players-desktop" href="parent-dashboard.html" class="hidden text-sm font-medium text-gray-600 hover:text-primary-700 transition">My Players</a>
              <a id="nav-my-teams-desktop" href="dashboard.html" class="hidden text-sm font-medium text-gray-600 hover:text-primary-700 transition">My Teams</a>
              <a id="nav-profile-desktop" href="profile.html" class="hidden text-sm font-medium text-gray-600 hover:text-primary-700 transition">Profile</a>
              <a id="nav-signin-desktop" href="login.html" class="text-sm font-medium text-primary-600 hover:text-primary-700 transition">Sign In</a>
              <a id="nav-cta-desktop" href="login.html#signup" class="text-sm font-medium px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg hover:from-primary-700 hover:to-primary-800 transition shadow-md hover:shadow-lg">Get Started</a>
              <button id="nav-logout-desktop" class="hidden text-sm font-medium text-gray-600 hover:text-primary-700 transition" type="button">Log out</button>
            </div>

            <!-- Mobile Menu Button -->
            <button id="mobile-menu-btn" class="md:hidden p-2 text-gray-600 hover:text-primary-600 focus:outline-none">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </button>
          </div>

          <!-- Mobile Menu -->
          <div id="mobile-menu" class="hidden md:hidden mt-4 pb-4 border-t border-gray-100">
            <div class="flex flex-col space-y-3 pt-4" id="nav-auth-actions-mobile">
              <a href="teams.html" class="block text-base font-medium text-gray-600 hover:text-primary-600 transition">Browse Teams</a>
              <a id="nav-my-players-mobile" href="parent-dashboard.html" class="hidden block text-base font-medium text-gray-600 hover:text-primary-700 transition">My Players</a>
              <a id="nav-my-teams-mobile" href="dashboard.html" class="hidden block text-base font-medium text-gray-600 hover:text-primary-700 transition">My Teams</a>
              <a id="nav-profile-mobile" href="profile.html" class="hidden block text-base font-medium text-gray-600 hover:text-primary-700 transition">Profile</a>
              <a id="nav-signin-mobile" href="login.html" class="block text-base font-medium text-primary-600 hover:text-primary-700 transition">Sign In</a>
              <a id="nav-cta-mobile" href="login.html#signup" class="block text-center text-base font-medium px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg hover:from-primary-700 hover:to-primary-800 transition shadow-md">Get Started</a>
              <button id="nav-logout-mobile" class="hidden w-full text-left block text-base font-medium text-gray-600 hover:text-primary-700 transition" type="button">Log out</button>
            </div>
          </div>
        </nav>
      </header>
    `;

  // Mobile menu toggle
  const mobileBtn = container.querySelector('#mobile-menu-btn');
  const mobileMenu = container.querySelector('#mobile-menu');
  mobileBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
  });

  // Update navigation based on auth state
  const updateNav = (suffix) => {
    const navSignIn = container.querySelector(`#nav-signin-${suffix}`);
    const navCta = container.querySelector(`#nav-cta-${suffix}`);
    const navLogout = container.querySelector(`#nav-logout-${suffix}`);
    const navProfile = container.querySelector(`#nav-profile-${suffix}`);
    const navMyPlayers = container.querySelector(`#nav-my-players-${suffix}`);
    const navMyTeams = container.querySelector(`#nav-my-teams-${suffix}`);

    if (user) {
      const hasParentLinks = Array.isArray(user.parentOf) && user.parentOf.length > 0;
      const hasCoachAccess = user.isAdmin || (Array.isArray(user.coachOf) && user.coachOf.length > 0);

      if (navMyPlayers) {
        navMyPlayers.classList.remove('hidden');
        navMyPlayers.href = 'parent-dashboard.html';
        // Optional: if user has no parent links, we still let them in;
        // the page will explain they have no linked players.
      }

      if (navMyTeams) {
        navMyTeams.classList.remove('hidden');
        navMyTeams.href = 'dashboard.html';
      }

      if (navSignIn) {
        // Hide the generic Sign In link when logged in
        navSignIn.classList.add('hidden');
      }

      // CTA button logic
      if (user.isAdmin) {
        // Admins see "Admin Dashboard"
        navCta.textContent = 'Admin Dashboard';
        navCta.href = 'admin.html';
        navCta.classList.remove('hidden');
      } else {
        // Regular users don't see the CTA button
        navCta.classList.add('hidden');
      }

      navLogout.classList.remove('hidden');
      navProfile.classList.remove('hidden');
    } else {
      if (navMyPlayers) navMyPlayers.classList.add('hidden');
      if (navMyTeams) navMyTeams.classList.add('hidden');

      if (navSignIn) {
        navSignIn.classList.remove('hidden');
        navSignIn.textContent = 'Sign In';
        navSignIn.href = 'login.html';
      }

      navCta.textContent = 'Get Started';
      navCta.href = 'login.html#signup';

      navLogout.classList.add('hidden');
      navProfile.classList.add('hidden');
    }

    // Add logout handler
    navLogout.addEventListener('click', async () => {
      const { logout } = await import('./auth.js?v=9');
      await logout();
      window.location.href = 'index.html';
    });
  };

  updateNav('desktop');
  updateNav('mobile');

  // Global search: injected into the shared header in one place.
  // Lazy-import to avoid adding weight to initial render and to avoid circular deps.
  try {
    import('./global-search.js?v=7')
      .then(({ setupHeaderSearch }) => {
        if (typeof setupHeaderSearch === 'function') {
          setupHeaderSearch({ user, headerContainer: container });
        }
      })
      .catch((e) => console.warn('[GlobalSearch] Failed to load:', e));
  } catch (e) {
    console.warn('[GlobalSearch] Failed to initialize:', e);
  }
}

export function renderFooter(container) {
  container.innerHTML = `
      <footer class="bg-gray-900 text-gray-400 py-12 md:py-16">
        <div class="container mx-auto px-4">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div class="col-span-1 md:col-span-2">
              <div class="flex items-center space-x-3 mb-4">
                <div class="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
                  <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                  </svg>
                </div>
                <h3 class="text-xl font-bold text-white">ALL PLAYS</h3>
              </div>
              <p class="text-sm max-w-md">Modern team management and statistics platform for coaches. Track stats, manage schedules, and build winning teams—completely free.</p>
            </div>

            <div>
              <h4 class="text-white font-semibold mb-4">Platform</h4>
              <ul class="space-y-2 text-sm">
                <li><a href="teams.html" class="hover:text-white transition">Browse Teams</a></li>
                <li><a href="dashboard.html" class="hover:text-white transition">Dashboard</a></li>
                <li><a href="login.html" class="hover:text-white transition">Sign In</a></li>
              </ul>
            </div>

            <div>
              <h4 class="text-white font-semibold mb-4">Support</h4>
              <ul class="space-y-2 text-sm">
                <li><a href="#" class="hover:text-white transition">Help Center</a></li>
                <li><a href="#" class="hover:text-white transition">Contact</a></li>
                <li><a href="https://github.com/pauljsnider/paulsnidernet" class="hover:text-white transition" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              </ul>
            </div>
          </div>

          <div class="border-t border-gray-800 pt-8 text-center text-sm space-y-1">
            <p>&copy; 2025 ALL PLAYS. Built with ❤️ for coaches everywhere.</p>
            <p>Created by <a href="https://paulsnider.net" class="text-gray-200 hover:text-white underline">Paul Snider</a>.</p>
          </div>
        </div>
      </footer>
    `;
}

// Calendar / ICS Parsing Functions

/**
 * Fetch and parse an ICS calendar file
 * @param {string} url - URL to the .ics file
 * @returns {Promise<Array>} Array of parsed calendar events
 */
export async function fetchAndParseCalendar(url) {
  const timeoutMs = 5000;

  function normalizeIcsText(text) {
    const marker = 'BEGIN:VCALENDAR';
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) {
      return text;
    }
    return text.slice(markerIndex);
  }

  async function fetchWithTimeout(fetchUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  }

  function buildProxyUrls(targetUrl) {
    const cleanedUrl = targetUrl.trim();
    const httpsUrl = cleanedUrl.replace(/^http:\/\//i, 'https://');
    return [
      `https://corsproxy.io/?${encodeURIComponent(httpsUrl)}`,
      `https://r.jina.ai/https://${httpsUrl.replace(/^https:\/\//i, '')}`,
      `https://r.jina.ai/http://${httpsUrl.replace(/^https?:\/\//i, '')}`
    ];
  }

  try {
    // Try direct fetch first
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.statusText}`);
    }
    const icsText = await response.text();
    return parseICS(normalizeIcsText(icsText));
  } catch (error) {
    // If direct fetch fails, try with proxy fallbacks
    const shouldTryProxy = error.name === 'TypeError' ||
                           error.name === 'AbortError' ||
                           error.message.includes('fetch') ||
                           error.message.includes('CORS');
    if (shouldTryProxy) {
      const proxyUrls = buildProxyUrls(url);
      for (const proxyUrl of proxyUrls) {
        try {
          console.log('Calendar fetch failed, trying proxy:', proxyUrl);
          const response = await fetchWithTimeout(proxyUrl);
          if (!response.ok) {
            throw new Error(`Proxy fetch failed: ${response.status} ${response.statusText}`);
          }
          const icsText = await response.text();
          return parseICS(normalizeIcsText(icsText));
        } catch (proxyError) {
          console.warn('Proxy fetch attempt failed:', proxyError);
        }
      }
      throw new Error('Cannot fetch calendar. All proxy attempts failed.');
    }
    console.error('Error fetching calendar:', error);
    throw error;
  }
}

/**
 * Parse ICS calendar text into event objects
 * @param {string} icsText - Raw ICS file content
 * @returns {Array} Array of parsed events
 */
export function parseICS(icsText) {
  const events = [];
  const lines = icsText.split(/\r\n|\n|\r/);

  let currentEvent = null;
  let currentField = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Handle line continuation (lines starting with space/tab)
    while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
      i++;
      line += lines[i].trim();
    }

    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.dtstart && currentEvent.summary) {
        events.push(currentEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const field = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);

        const fieldName = field.split(';')[0]; // Handle fields like DTSTART;TZID=...

        switch (fieldName) {
          case 'DTSTART':
            currentEvent.dtstart = parseICSDate(value);
            break;
          case 'DTEND':
            currentEvent.dtend = parseICSDate(value);
            break;
          case 'SUMMARY':
            currentEvent.summary = value;
            currentEvent.isPractice = isPracticeEvent(value);
            break;
          case 'DESCRIPTION':
            currentEvent.description = value;
            break;
          case 'LOCATION':
            currentEvent.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
            break;
          case 'UID':
            currentEvent.uid = value;
            break;
          case 'STATUS':
            currentEvent.status = value;
            break;
        }
      }
    }
  }

  return events;
}

/**
 * Parse ICS date format to JavaScript Date
 * @param {string} icsDate - Date string from ICS file
 * @returns {Date} JavaScript Date object
 */
function parseICSDate(icsDate) {
  // ICS dates are in format: 20251115T020000Z or 20251115
  const year = parseInt(icsDate.substring(0, 4));
  const month = parseInt(icsDate.substring(4, 6)) - 1; // JS months are 0-indexed
  const day = parseInt(icsDate.substring(6, 8));

  if (icsDate.length > 8) {
    // Has time component
    const hour = parseInt(icsDate.substring(9, 11));
    const minute = parseInt(icsDate.substring(11, 13));
    const second = parseInt(icsDate.substring(13, 15));

    if (icsDate.endsWith('Z')) {
      // UTC time
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    } else {
      // Local time
      return new Date(year, month, day, hour, minute, second);
    }
  } else {
    // Date only
    return new Date(year, month, day);
  }
}

/**
 * Extract opponent name from event summary
 * Patterns: "Team @ Opponent", "Team vs Opponent", "Opponent vs Team"
 * @param {string} summary - Event summary/title
 * @param {string} teamName - Name of the team (optional)
 * @returns {string} Opponent name or summary if no pattern matched
 */
export function extractOpponent(summary, teamName = '') {
  if (!summary) return 'Unknown';

  // Check for "@ Opponent" pattern
  const atMatch = summary.match(/@\s*(.+)/);
  if (atMatch) {
    return atMatch[1].trim();
  }

  // Check for "vs Opponent" pattern
  const vsMatch = summary.match(/vs\.?\s+(.+)/i);
  if (vsMatch) {
    const opponent = vsMatch[1].trim();
    if (teamName) {
      const escaped = teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleaned = opponent.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '').trim();
      if (cleaned) return cleaned;
    }
    return opponent;
  }

  // Check for "Opponent vs Team" pattern (reverse)
  const reverseVsMatch = summary.match(/(.+?)\s+vs\.?\s+/i);
  if (reverseVsMatch && teamName && summary.toLowerCase().includes(teamName.toLowerCase())) {
    const opponent = reverseVsMatch[1].trim();
    if (!opponent.toLowerCase().includes(teamName.toLowerCase())) {
      return opponent;
    }
  }

  // No pattern matched, return summary
  return summary;
}

/**
 * Check if event is a practice (not a game)
 * @param {string} summary - Event summary/title
 * @returns {boolean} True if event is a practice
 */
export function isPracticeEvent(summary) {
  if (!summary) return false;
  const lowerSummary = summary.toLowerCase();
  return lowerSummary.includes('practice') ||
    lowerSummary.includes('training') ||
    lowerSummary.includes('skills club');
}

// ============================================
// Practice & Event Utilities - Phase 1
// ============================================

/**
 * Format a time range for display (e.g., "6:00 PM - 8:00 PM")
 * @param {Date|Timestamp|string} start - Start time
 * @param {Date|Timestamp|string} end - End time
 * @returns {string} Formatted time range
 */
export function formatTimeRange(start, end) {
  if (!start) return '';
  const startStr = formatTime(start);
  if (!end) return startStr;
  const endStr = formatTime(end);
  return `${startStr} - ${endStr}`;
}

/**
 * Compute default end time based on event type
 * @param {Date|Timestamp|string} startDate - Start date/time
 * @param {string} type - Event type ('game' or 'practice')
 * @returns {Date|null} Default end time
 */
export function getDefaultEndTime(startDate, type = 'game') {
  if (!startDate) return null;
  const date = startDate.toDate ? startDate.toDate() : new Date(startDate);
  // Practices default to 1.5 hours, games to 2 hours
  const durationMs = type === 'practice' ? 90 * 60 * 1000 : 120 * 60 * 1000;
  return new Date(date.getTime() + durationMs);
}

// ============================================
// Recurring Practices - Phase 2
// ============================================

/**
 * Generate a UUID v4 for series identification
 * @returns {string} UUID string
 */
export function generateSeriesId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Day code mapping for recurrence
 */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Expand a recurring practice master into individual occurrences
 * @param {Object} master - The series master document
 * @param {number} windowDays - Number of days to expand into the future (default 180)
 * @returns {Array} Array of occurrence objects
 */
export function expandRecurrence(master, windowDays = 180) {
  // If not a series master, return as single item
  if (!master.isSeriesMaster || !master.recurrence) {
    return [master];
  }

  const occurrences = [];
  const now = new Date();
  const pastWindow = 14; // Show past 14 days for recent cancellations
  const windowStart = new Date(now.getTime() - pastWindow * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const { freq, interval = 1, byDays = [], until, count } = master.recurrence;
  const exDates = master.exDates || [];
  const overrides = master.overrides || {};
  let untilBoundary = null;

  if (until) {
    const untilDate = until.toDate ? until.toDate() : new Date(until);
    untilBoundary = new Date(untilDate);

    const isLocalMidnight =
      untilBoundary.getHours() === 0 &&
      untilBoundary.getMinutes() === 0 &&
      untilBoundary.getSeconds() === 0 &&
      untilBoundary.getMilliseconds() === 0;
    const isUtcMidnight =
      untilBoundary.getUTCHours() === 0 &&
      untilBoundary.getUTCMinutes() === 0 &&
      untilBoundary.getUTCSeconds() === 0 &&
      untilBoundary.getUTCMilliseconds() === 0;

    // Handle UTC date-only parsing first (new Date('YYYY-MM-DD') from date inputs).
    if (isUtcMidnight) {
      untilBoundary = new Date(
        untilBoundary.getUTCFullYear(),
        untilBoundary.getUTCMonth(),
        untilBoundary.getUTCDate(),
        23,
        59,
        59,
        999
      );
    } else if (isLocalMidnight) {
      // Local date-only values should include the full local end date.
      untilBoundary.setHours(23, 59, 59, 999);
    }
  }

  // Start from series creation date
  const seriesStart = master.date?.toDate ? master.date.toDate() : new Date(master.date || master.createdAt?.toDate?.() || now);
  let current = new Date(seriesStart);
  let generated = 0;

  // For weekly recurrence, we need to check each day
  const maxIterations = windowDays * 2; // Safety limit
  let iterations = 0;

  while (current <= windowEnd && iterations < maxIterations) {
    iterations++;

    // Check end conditions
    if (untilBoundary) {
      if (current > untilBoundary) break;
    }
    if (count && generated >= count) break;

    const isoDate = current.toISOString().split('T')[0];
    const dayCode = DAY_CODES[current.getDay()];

    // Check if this day matches the recurrence pattern
    let matches = false;
    if (freq === 'weekly' && byDays.length > 0) {
      matches = byDays.includes(dayCode);
    } else if (freq === 'daily') {
      matches = true;
    } else if (freq === 'weekly' && byDays.length === 0) {
      // If no specific days, match the same day as series start
      matches = current.getDay() === seriesStart.getDay();
    }

    // Only process if within visible window and matches pattern
    if (matches && current >= windowStart && !exDates.includes(isoDate)) {
      const override = overrides[isoDate] || {};

      // Build the occurrence object
      const occurrence = {
        ...master,
        id: master.id, // Keep master ID for reference
        masterId: master.id,
        instanceDate: isoDate,
        isInstance: true,
        // Apply overrides or use master defaults
        title: override.title || master.title,
        location: override.location || master.location,
        notes: override.notes || master.notes,
        startTime: override.startTime || master.startTime,
        endTime: override.endTime || master.endTime,
        // Mark if this occurrence has been modified
        isModified: Object.keys(override).length > 0
      };

      // Compute actual date/time for this occurrence
      if (master.startTime) {
        const [hours, minutes] = (override.startTime || master.startTime).split(':').map(Number);
        const occDate = new Date(current);
        occDate.setHours(hours, minutes, 0, 0);
        occurrence.date = occDate;

        if (master.endTime || override.endTime) {
          const [endHours, endMinutes] = (override.endTime || master.endTime).split(':').map(Number);
          const endDate = new Date(current);
          endDate.setHours(endHours, endMinutes, 0, 0);
          occurrence.end = endDate;
        }
      } else {
        occurrence.date = new Date(current);
      }

      occurrences.push(occurrence);
      generated++;
    }

    // Advance to next day
    current.setDate(current.getDate() + 1);

    // For daily with interval > 1, skip days
    if (freq === 'daily' && interval > 1) {
      current.setDate(current.getDate() + interval - 1);
    }
  }

  return occurrences;
}

/**
 * Format recurrence rule for display
 * @param {Object} recurrence - Recurrence object { freq, interval, byDays, until, count }
 * @returns {string} Human-readable recurrence description
 */
export function formatRecurrence(recurrence) {
  if (!recurrence) return '';

  const { freq, interval = 1, byDays = [], until, count } = recurrence;

  let text = '';

  // Frequency
  if (freq === 'daily') {
    text = interval === 1 ? 'Daily' : `Every ${interval} days`;
  } else if (freq === 'weekly') {
    if (interval === 1) {
      text = 'Weekly';
    } else {
      text = `Every ${interval} weeks`;
    }

    // Days
    if (byDays.length > 0) {
      const dayNames = {
        'SU': 'Sun', 'MO': 'Mon', 'TU': 'Tue', 'WE': 'Wed',
        'TH': 'Thu', 'FR': 'Fri', 'SA': 'Sat'
      };
      const dayList = byDays.map(d => dayNames[d] || d).join(', ');
      text += ` on ${dayList}`;
    }
  }

  // End condition
  if (until) {
    const untilDate = until.toDate ? until.toDate() : new Date(until);
    text += ` until ${untilDate.toLocaleDateString()}`;
  } else if (count) {
    text += `, ${count} times`;
  }

  return text;
}
