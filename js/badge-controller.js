import { checkAuth } from './auth.js?v=4433210';
import { getUserTeamsWithAccess, getGames } from './db.js?v=4433206';
import { functions, httpsCallable } from './firebase.js?v=4433195';
const $ = id => document.getElementById(id);
const configure = httpsCallable(functions, 'configureBadgeScoreController');
let activeUser = null;
let pendingPair = null;
let busy = false;
function status(text) { $('status').textContent = text; }
function options(element, items, label) {
    element.replaceChildren(...items.map(item => { const opt = document.createElement('option'); opt.value = item.id; opt.textContent = label(item); return opt; }));
    element.disabled = !items.length;
}
async function operation(fn) {
    if (busy) return;
    busy = true;
    ['pair','release','revoke'].forEach(id => $(id).disabled = true);
    try { await fn(); } catch (error) { status(error.message || 'Request failed. Try again.'); }
    finally { busy = false; $('pair').disabled = !activeUser || !$('team').value; $('release').disabled = !activeUser || !$('game').value; $('revoke').disabled = !activeUser || !$('revoke-file').files.length; }
}
async function loadGames() {
    options($('game'), [], g => g.id);
    if (!$('team').value) return;
    const teamId = $('team').value;
    const games = await getGames(teamId);
    if (teamId !== $('team').value) return;
    options($('game'), games.filter(g => g.badgeScoreControl), g => g.opponent || g.opponentTeamName || g.id);
}
checkAuth(user => operation(async () => {
    activeUser = user;
    if (!user) { status('Sign in to AllPlays first, then return to this page.'); const a = document.createElement('a'); a.href = 'login.html'; a.textContent = 'Sign in'; $('status').append(' ', a); return; }
    const teams = await getUserTeamsWithAccess(user.uid, user.email);
    options($('team'), teams, t => t.name || 'Team');
    await loadGames();
    status(teams.length ? 'Choose a team and download the pairing file.' : 'No managed teams available.');
}));
$('team').addEventListener('change', () => operation(async () => { pendingPair = null; await loadGames(); }));
$('pair').addEventListener('click', () => operation(async () => {
    const teamId = $('team').value;
    if (!pendingPair || pendingPair.teamId !== teamId) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        pendingPair = { teamId, token: Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('') };
    }
    await configure({ action: 'create', ...pendingPair });
    const blob = new Blob([JSON.stringify({ host: 'us-central1-game-flow-c6311.cloudfunctions.net', path: '/badgeScoreController', ...pendingPair })], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'controller.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Pairing file downloaded. Copy controller.json into apps/allplays_scoreboard on your badge.');
}));
$('release').addEventListener('click', () => operation(async () => {
    await configure({ action: 'release', teamId: $('team').value, gameId: $('game').value });
    await loadGames(); status('Badge control released. Reload your regular tracker before continuing.');
}));
$('revoke-file').addEventListener('change', () => { $('revoke').disabled = !activeUser || !$('revoke-file').files.length; });
$('revoke').addEventListener('click', () => operation(async () => {
    const file = $('revoke-file').files[0]; if (!file || file.size > 4096) throw new Error('Choose the controller.json pairing file.');
    const data = JSON.parse(await file.text());
    await configure({ action: 'revoke', teamId: data.teamId, token: data.token });
    status('Pairing revoked. Release any controlled game above before using another tracker.');
}));
