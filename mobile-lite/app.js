import { initializeApp } from './vendor/firebase-app.js';
import {
    getAuth,
    indexedDBLocalPersistence,
    initializeAuth,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut
} from './vendor/firebase-auth.js';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    query,
    serverTimestamp,
    setDoc,
    where
} from './vendor/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
    authDomain: 'game-flow-c6311.firebaseapp.com',
    projectId: 'game-flow-c6311',
    storageBucket: 'game-flow-c6311.firebasestorage.app',
    messagingSenderId: '1030107289033',
    appId: '1:1030107289033:web:7154238712942475143046',
    measurementId: 'G-E48D0L8L40'
};

const app = initializeApp(firebaseConfig);
let auth;
try {
    auth = initializeAuth(app, {
        persistence: indexedDBLocalPersistence
    });
} catch (error) {
    console.warn('[mobile-lite] Explicit auth initialization fell back to getAuth:', error);
    auth = getAuth(app);
}
const db = getFirestore(app);

const els = {
    signedOutView: document.getElementById('signed-out-view'),
    signedInView: document.getElementById('signed-in-view'),
    loginForm: document.getElementById('login-form'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    loginButton: document.getElementById('login-button'),
    resetButton: document.getElementById('reset-button'),
    logoutButton: document.getElementById('logout-button'),
    authMessage: document.getElementById('auth-message'),
    platformBadge: document.getElementById('platform-badge'),
    firebaseState: document.getElementById('firebase-state'),
    profileState: document.getElementById('profile-state'),
    originState: document.getElementById('origin-state'),
    sessionSubtitle: document.getElementById('session-subtitle'),
    profileEmail: document.getElementById('profile-email'),
    profileUid: document.getElementById('profile-uid'),
    profileRoles: document.getElementById('profile-roles'),
    profileTeams: document.getElementById('profile-teams'),
    teamsState: document.getElementById('teams-state'),
    teamsList: document.getElementById('teams-list')
};

const FIRESTORE_TIMEOUT_MS = 10000;

function getPlatformLabel() {
    const capacitor = window.Capacitor;
    if (capacitor?.getPlatform) {
        const platform = capacitor.getPlatform();
        return platform === 'ios' || platform === 'android' ? platform.toUpperCase() : 'Web';
    }
    return 'Web';
}

function setMessage(message, tone = 'neutral') {
    els.authMessage.textContent = message || '';
    els.authMessage.className = `message${tone === 'error' ? ' error' : ''}${tone === 'success' ? ' success' : ''}`;
}

function setBusy(isBusy) {
    els.loginButton.disabled = isBusy;
    els.resetButton.disabled = isBusy;
}

function getAuthEmail() {
    return els.email.value.trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function withTimeout(promise, label, timeoutMs = FIRESTORE_TIMEOUT_MS) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(label)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        window.clearTimeout(timeoutId);
    });
}

function describeAuthError(error) {
    const code = error?.code || '';
    if (isBlockedRefererError(error)) {
        return getBlockedRefererGuidance();
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        return 'Email or password is incorrect.';
    }
    if (code === 'auth/user-not-found') {
        return 'No ALL PLAYS account was found for that email.';
    }
    if (code === 'auth/too-many-requests') {
        return 'Too many attempts. Wait a bit and try again.';
    }
    if (code === 'auth/network-request-failed') {
        return 'Network request failed. Check the device connection.';
    }
    return error?.message || 'Authentication failed.';
}

function isBlockedRefererError(error) {
    const details = `${error?.code || ''} ${error?.message || ''}`;
    return details.includes('requests-from-referer-') && details.includes('are-blocked');
}

function getBlockedRefererGuidance() {
    const origin = window.location.origin || 'capacitor://localhost';
    return `Firebase is blocking ${origin}. Add ${origin}/* to the Firebase Web API key HTTP referrers, or use native Firebase app config for store builds.`;
}

function getRoleSummary(profile = {}) {
    const roles = [];
    if (profile.isAdmin === true) roles.push('Admin');
    if (Array.isArray(profile.coachOf) && profile.coachOf.length > 0) roles.push('Coach');
    if (Array.isArray(profile.parentOf) && profile.parentOf.length > 0) roles.push('Parent');
    return roles.length ? roles.join(', ') : 'Member';
}

function getTeamSummary(profile = {}) {
    const teamIds = new Set();
    if (Array.isArray(profile.coachOf)) {
        profile.coachOf.filter(Boolean).forEach((teamId) => teamIds.add(teamId));
    }
    if (Array.isArray(profile.parentTeamIds)) {
        profile.parentTeamIds.filter(Boolean).forEach((teamId) => teamIds.add(teamId));
    }
    if (Array.isArray(profile.parentOf)) {
        profile.parentOf
            .map((entry) => entry?.teamId)
            .filter(Boolean)
            .forEach((teamId) => teamIds.add(teamId));
    }
    return teamIds.size ? `${teamIds.size} linked` : 'None found';
}

async function updateLastLogin(user) {
    try {
        await withTimeout(setDoc(doc(db, 'users', user.uid), {
            email: user.email || '',
            lastLogin: serverTimestamp()
        }, { merge: true }), 'Last login update timed out');
    } catch (error) {
        console.warn('[mobile-lite] Unable to update lastLogin:', error);
    }
}

async function loadProfile(user) {
    els.profileState.textContent = 'Loading';
    const snapshot = await withTimeout(getDoc(doc(db, 'users', user.uid)), 'Profile load timed out');
    if (!snapshot.exists()) {
        els.profileState.textContent = 'No users profile document';
        return {};
    }
    els.profileState.textContent = 'Loaded';
    return snapshot.data() || {};
}

function isTeamActive(team) {
    return team?.active !== false;
}

function normalizeTeam(docSnapshot, access) {
    return {
        id: docSnapshot.id,
        access,
        ...docSnapshot.data()
    };
}

function getParentTeamIds(profile = {}) {
    const teamIds = new Set();
    if (Array.isArray(profile.parentTeamIds)) {
        profile.parentTeamIds.filter(Boolean).forEach((teamId) => teamIds.add(teamId));
    }
    if (Array.isArray(profile.parentOf)) {
        profile.parentOf
            .map((entry) => entry?.teamId)
            .filter(Boolean)
            .forEach((teamId) => teamIds.add(teamId));
    }
    return Array.from(teamIds);
}

async function getParentTeam(teamId) {
    const snapshot = await getDoc(doc(db, 'teams', teamId));
    return snapshot.exists() ? normalizeTeam(snapshot, 'parent') : null;
}

async function loadTeams(user, profile = {}) {
    els.teamsState.textContent = 'Loading';
    els.teamsList.innerHTML = '<p class="empty-state">Loading your teams...</p>';

    const email = (user.email || profile.email || '').trim().toLowerCase();
    const ownedTeamsQuery = getDocs(query(collection(db, 'teams'), where('ownerId', '==', user.uid)));
    const adminTeamsQuery = email
        ? getDocs(query(collection(db, 'teams'), where('adminEmails', 'array-contains', email)))
        : Promise.resolve({ docs: [] });
    const parentTeamQueries = getParentTeamIds(profile).map((teamId) => getParentTeam(teamId));

    const [ownedTeamsSnapshot, adminTeamsSnapshot, parentTeams] = await withTimeout(
        Promise.all([
            ownedTeamsQuery,
            adminTeamsQuery,
            Promise.all(parentTeamQueries)
        ]),
        'Teams load timed out'
    );

    const teamsById = new Map();
    ownedTeamsSnapshot.docs.forEach((teamDoc) => teamsById.set(teamDoc.id, normalizeTeam(teamDoc, 'full')));
    adminTeamsSnapshot.docs.forEach((teamDoc) => teamsById.set(teamDoc.id, normalizeTeam(teamDoc, 'full')));
    parentTeams.filter(Boolean).forEach((team) => {
        if (!teamsById.has(team.id)) {
            teamsById.set(team.id, team);
        }
    });

    const teams = Array.from(teamsById.values())
        .filter(isTeamActive)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    renderTeams(teams);
    return teams;
}

function renderTeams(teams) {
    els.teamsState.textContent = `${teams.length} found`;

    if (teams.length === 0) {
        els.teamsList.innerHTML = `
            <div class="empty-state">
                <strong>No teams found</strong>
                <span>This account is signed in, but no coach/admin or parent teams are linked yet.</span>
            </div>
        `;
        return;
    }

    els.teamsList.innerHTML = teams.map((team) => {
        const name = team.name || 'Unnamed team';
        const sport = team.sport || 'Sport not set';
        const access = team.access === 'parent' ? 'Parent view' : 'Full access';
        const initials = name.trim().charAt(0).toUpperCase() || 'T';
        const imageMarkup = team.photoUrl
            ? `<img src="${escapeHtml(team.photoUrl)}" alt="" class="team-photo">`
            : `<span class="team-initial">${escapeHtml(initials)}</span>`;

        return `
            <article class="team-card">
                <div class="team-avatar">
                    ${imageMarkup}
                </div>
                <div class="team-details">
                    <h3>${escapeHtml(name)}</h3>
                    <p>${escapeHtml(sport)}</p>
                    <span>${escapeHtml(access)}</span>
                </div>
            </article>
        `;
    }).join('');
}

function renderSignedOut() {
    els.signedOutView.classList.remove('hidden');
    els.signedInView.classList.add('hidden');
    els.firebaseState.textContent = 'Signed out';
    els.profileState.textContent = 'Waiting';
    els.profileEmail.textContent = '-';
    els.profileUid.textContent = '-';
    els.profileRoles.textContent = '-';
    els.profileTeams.textContent = '-';
    els.teamsState.textContent = 'Waiting';
    els.teamsList.innerHTML = '';
}

async function renderSignedIn(user) {
    els.signedOutView.classList.add('hidden');
    els.signedInView.classList.remove('hidden');
    els.firebaseState.textContent = 'Signed in';
    els.sessionSubtitle.textContent = 'Firebase session is active in this WebView.';
    els.profileEmail.textContent = user.email || '(no email)';
    els.profileUid.textContent = user.uid;
    els.profileRoles.textContent = 'Loading';
    els.profileTeams.textContent = 'Loading';
    els.teamsState.textContent = 'Loading';

    try {
        const profile = await loadProfile(user);
        els.profileRoles.textContent = getRoleSummary(profile);
        updateLastLogin(user);
        const teams = await loadTeams(user, profile);
        els.profileTeams.textContent = teams.length ? `${teams.length} linked` : getTeamSummary(profile);
    } catch (error) {
        console.error('[mobile-lite] Dashboard load failed:', error);
        els.profileState.textContent = 'Failed';
        els.profileRoles.textContent = 'Unknown';
        els.profileTeams.textContent = 'Unknown';
        els.teamsState.textContent = 'Failed';
        els.teamsList.innerHTML = `
            <div class="empty-state error-state">
                <strong>Dashboard failed to load</strong>
                <span>${escapeHtml(error?.message || 'Unknown Firestore error')}</span>
            </div>
        `;
    }
}

async function signIn(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);

    try {
        const email = getAuthEmail();
        const password = els.password.value;
        await signInWithEmailAndPassword(auth, email, password);
        setMessage('Signed in.', 'success');
    } catch (error) {
        console.error('[mobile-lite] Sign-in failed:', error);
        if (isBlockedRefererError(error)) {
            els.firebaseState.textContent = 'Blocked native referrer';
        }
        setMessage(describeAuthError(error), 'error');
    } finally {
        setBusy(false);
    }
}

async function sendReset() {
    const email = getAuthEmail();
    if (!email) {
        setMessage('Enter your email first.', 'error');
        els.email.focus();
        return;
    }

    setBusy(true);
    setMessage('');

    try {
        await sendPasswordResetEmail(auth, email, {
            url: 'https://allplays.ai/reset-password.html',
            handleCodeInApp: true
        });
        setMessage('Password reset email sent.', 'success');
    } catch (error) {
        console.error('[mobile-lite] Reset email failed:', error);
        if (isBlockedRefererError(error)) {
            els.firebaseState.textContent = 'Blocked native referrer';
        }
        setMessage(describeAuthError(error), 'error');
    } finally {
        setBusy(false);
    }
}

async function logOut() {
    setMessage('');
    els.profileState.textContent = 'Signing out';
    await signOut(auth);
}

async function start() {
    els.platformBadge.textContent = getPlatformLabel();
    els.originState.textContent = window.location.origin || '(local file origin)';
    els.firebaseState.textContent = 'Initializing';

    els.loginForm.addEventListener('submit', signIn);
    els.resetButton.addEventListener('click', sendReset);
    els.logoutButton.addEventListener('click', () => {
        logOut().catch((error) => {
            console.error('[mobile-lite] Sign-out failed:', error);
            els.profileState.textContent = 'Sign-out failed';
        });
    });

    onAuthStateChanged(auth, (user) => {
        if (user) {
            renderSignedIn(user);
        } else {
            renderSignedOut();
        }
    });

    window.setTimeout(() => {
        if (els.firebaseState.textContent === 'Initializing') {
            els.firebaseState.textContent = 'Ready, waiting for auth state';
        }
    }, 1500);
}

start().catch((error) => {
    console.error('[mobile-lite] Startup failed:', error);
    els.firebaseState.textContent = 'Startup failed';
    setMessage(error?.message || 'Startup failed.', 'error');
});
