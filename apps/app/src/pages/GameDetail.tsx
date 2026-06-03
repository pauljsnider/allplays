import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { BarChart3, Brain, Car, ClipboardCheck, FileText, ListTree, MessageCircleReply, Radio, Share2, Shield, Trophy, Users } from 'lucide-react';
import { LiveGameAnnouncerToggle } from '../components/LiveGameAnnouncerToggle';
import { mockGames, mockPlayers, mockTeams } from '../data/mockData';
import { canUseLiveGameChat, getLiveGameChatNotice, sendLiveGameChatMessage, subscribeToLiveGameChat, type LiveGameChatMessage } from '../lib/liveGameChatService';
import { applyWalk, createBaseballLiveState, type BaseballBases, type BaseballLiveState } from '../lib/sportScoring/baseballScorekeepingService';
import { createPlayAnnouncer } from '../lib/liveGameAnnouncerService';
import type { AuthState } from '../lib/types';

export function GameDetail({ auth }: { auth: AuthState }) {
  const { gameId } = useParams();
  const game = mockGames.find((item) => item.id === gameId);
  const [baseballState, setBaseballState] = useState<BaseballLiveState>(() => createBaseballLiveState());
  const [lastScoringAction, setLastScoringAction] = useState('Ready for pitch');
  const team = game ? mockTeams.find((item) => item.id === game.teamId) : null;
  const canScoreBaseball = (auth.isCoach || auth.isAdmin) && (team?.sport === 'Baseball' || team?.sport === 'Softball');
  const liveEvents = game?.liveEvents || [];
  const announcer = useMemo(() => createPlayAnnouncer(), []);
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(() => announcer.isEnabled());
  const [chatMessages, setChatMessages] = useState<LiveGameChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [anonymousDisplayName, setAnonymousDisplayName] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const [chatReady, setChatReady] = useState(false);

  useEffect(() => {
    if (!game) return;

    announcer.setEnabled(announcementsEnabled);
    if (!announcementsEnabled) return;

    liveEvents.forEach((event) => {
      announcer.announceEvent(event, { playbackSessionId: game.id });
    });

    return () => {
      announcer.setPaused(true);
    };
  }, [announcer, announcementsEnabled, game, liveEvents]);

  useEffect(() => {
    if (!game) return;

    setChatReady(false);
    setChatError(null);

    return subscribeToLiveGameChat(game.teamId, game.id, (messages) => {
      setChatMessages(messages);
      setChatReady(true);
    }, () => {
      setChatError('Live chat is temporarily unavailable.');
      setChatReady(true);
    });
  }, [game?.id, game?.teamId]);

  if (!game) {
    return <Navigate to="/schedule" replace />;
  }

  const currentGame = game;
  const players = mockPlayers.filter((player) => currentGame.playerIds.includes(player.id));
  const liveChatEnabled = canUseLiveGameChat(currentGame, { isReplay: currentGame.status === 'past' });
  const liveChatNotice = getLiveGameChatNotice(currentGame, { isReplay: currentGame.status === 'past' });

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!liveChatEnabled) {
      setChatError(liveChatNotice || 'Live chat is unavailable right now.');
      return;
    }

    setChatError(null);
    setChatSending(true);
    try {
      await sendLiveGameChatMessage(currentGame.teamId, currentGame.id, {
        text: chatDraft,
        user: auth.user,
        anonymousDisplayName
      });
      setChatDraft('');
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Unable to send message.');
    } finally {
      setChatSending(false);
    }
  }

  function toggleBase(base: keyof BaseballBases) {
    setBaseballState((current) => ({
      ...current,
      bases: {
        ...current.bases,
        [base]: !current.bases[base]
      }
    }));
  }

  function recordWalk() {
    const result = applyWalk(baseballState);
    setBaseballState(result.state);
    setLastScoringAction(result.description);
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="app-label">{game.type}</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">{game.teamName} vs {game.opponent}</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{game.dateLabel} · {game.timeLabel} · {game.location}</p>
          </div>
          <Link to={`/messages/${game.teamId}`} className="secondary-button">
            <MessageCircleReply className="h-4 w-4" aria-hidden="true" />
            Reply
          </Link>
        </div>
        <div className="mt-4">
          <LiveGameAnnouncerToggle
            enabled={announcementsEnabled}
            supported={announcer.isSupported()}
            onToggle={setAnnouncementsEnabled}
          />
        </div>
      </section>

      {liveEvents.length > 0 ? (
        <section className="app-card p-4" aria-labelledby="live-play-by-play-heading">
          <h2 id="live-play-by-play-heading" className="app-section-title">Live play by play</h2>
          <div className="mt-3 space-y-2">
            {liveEvents.map((event) => (
              <div key={event.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-xs font-black uppercase tracking-wide text-primary-700">{event.period || 'Live'}</div>
                <div className="mt-1 text-sm font-semibold text-gray-700">{event.description}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-card p-4" aria-labelledby="live-game-chat-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="app-label">Game day chat</div>
            <h2 id="live-game-chat-heading" className="mt-1 text-lg font-black text-gray-950">Live chat</h2>
          </div>
          <div className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-primary-700">
            {liveChatEnabled ? 'Open' : 'Locked'}
          </div>
        </div>

        {liveChatNotice ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            {liveChatNotice}
          </div>
        ) : null}

        <div className="mt-3 space-y-2" data-testid="live-game-chat-thread">
          {chatMessages.length > 0 ? chatMessages.map((message) => (
            <div key={message.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-black uppercase tracking-wide text-gray-500">{message.senderName || 'Fan'}</div>
              <div className="mt-1 text-sm font-semibold text-gray-700">{message.text || ''}</div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm font-semibold text-gray-500">
              {chatReady ? 'No live game chat messages yet.' : 'Connecting to live game chat...'}
            </div>
          )}
        </div>

        <form className="mt-3 space-y-3" onSubmit={handleChatSubmit}>
          {!auth.user ? (
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-wide text-gray-500">Display name</span>
              <input
                type="text"
                aria-label="Display name"
                className="auth-input"
                value={anonymousDisplayName}
                onChange={(event) => setAnonymousDisplayName(event.target.value)}
                placeholder="Your first name"
                disabled={chatSending}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-gray-500">Message</span>
            <textarea
              aria-label="Message"
              className="auth-input min-h-24"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder={liveChatEnabled ? 'Send encouragement, updates, or reactions.' : 'Live chat is locked right now.'}
              disabled={chatSending || !liveChatEnabled}
            />
          </label>

          {chatError ? <div className="text-sm font-semibold text-rose-700">{chatError}</div> : null}

          <div className="flex justify-end">
            <button type="submit" className="primary-button" disabled={chatSending || !liveChatEnabled}>
              {chatSending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </form>
      </section>

      {auth.isCoach || auth.isAdmin ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Admin buttons
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {['Lineup', 'Tracker', 'RSVP', 'Wrap-up'].map((label) => (
              <Link key={label} to={`/capabilities/${label === 'Lineup' ? 'game-plan' : label === 'Tracker' ? 'track-standard' : label === 'RSVP' ? 'game-day' : 'game-report'}`} className="secondary-button justify-center">
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {canScoreBaseball ? (
        <section className="app-card p-4" aria-labelledby="baseball-live-scoring-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="app-label">Baseball live scoring</div>
              <h2 id="baseball-live-scoring-title" className="mt-1 text-lg font-black text-gray-950">Scorekeeper actions</h2>
              <p className="mt-1 text-xs font-semibold text-gray-500">{lastScoringAction}</p>
            </div>
            <button type="button" className="primary-button" onClick={recordWalk}>Walk</button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-black uppercase tracking-wide text-gray-500">Score</div>
              <div className="mt-1 text-sm font-black text-gray-950">{game.teamName} {baseballState.homeScore} · {game.opponent} {baseballState.awayScore}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-black uppercase tracking-wide text-gray-500">Count</div>
              <div className="mt-1 text-sm font-black text-gray-950" data-testid="baseball-count">{baseballState.balls}-{baseballState.strikes}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-black uppercase tracking-wide text-gray-500">Game state</div>
              <div className="mt-1 text-sm font-black text-gray-950">{baseballState.half === 'top' ? 'Top' : 'Bottom'} {baseballState.inning} · {baseballState.outs} outs</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2" aria-label="Base runners">
            {([
              ['first', '1B'],
              ['second', '2B'],
              ['third', '3B']
            ] as const).map(([base, label]) => (
              <button
                key={base}
                type="button"
                data-testid={`baseball-base-${base}`}
                aria-pressed={baseballState.bases[base]}
                onClick={() => toggleBase(base)}
                className={`rounded-full border px-3 py-1.5 text-xs font-black ${baseballState.bases[base] ? 'border-primary-500 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'}`}
              >
                {label} {baseballState.bases[base] ? 'occupied' : 'empty'}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="app-card p-4 lg:col-span-2">
          <h2 className="app-section-title">Availability</h2>
          <div className="mt-3 space-y-2">
            {players.map((player) => (
              <div key={player.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-gray-950">{player.name}</div>
                    <div className="text-xs font-semibold text-gray-500">#{player.number} · {player.teamName}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {['Going', 'Maybe', 'Out'].map((label) => (
                      <button key={label} type="button" className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-black text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Info icon={Car} title="Rideshare" detail={`${game.rideshare.seatsLeft} seats open · ${game.rideshare.requests} requests`} />
          <Info icon={ClipboardCheck} title="Assignments" detail={game.assignments.join(', ')} />
          <Info icon={Radio} title="Game" detail="Live tracker, stream, and postgame report hooks." />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Action icon={Share2} label="Share" to="/capabilities/game-report" />
        <Action icon={FileText} label="Match Report" to="/capabilities/game-report" />
        <Action icon={Brain} label="Insights" to="/capabilities/game-day" />
        <Action icon={BarChart3} label="Player Performance" to="/capabilities/player-profile" />
        <Action icon={ListTree} label="Play by Play" to="/capabilities/live-game" />
        <Action icon={Users} label="Opponent Stats" to="/capabilities/track-standard" />
        <Action icon={Trophy} label="Match Summary" to="/capabilities/game-report" />
      </section>
    </div>
  );
}

function Info({ icon: Icon, title, detail }: { icon: typeof Car; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-2 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}

function Action({ icon: Icon, label, to }: { icon: typeof Share2; label: string; to: string }) {
  return (
    <Link to={to} className="app-card flex min-h-24 flex-col justify-between p-4 transition hover:border-primary-200 hover:shadow-app-lg">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <span className="text-sm font-black text-gray-950">{label}</span>
    </Link>
  );
}
