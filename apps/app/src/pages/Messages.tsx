import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, Edit3, MessageCircle, MoreHorizontal, Paperclip, Send, ShieldCheck, Smile, Trash2 } from 'lucide-react';
import { mockMessages, mockTeams } from '../data/mockData';
import { useShellLayout } from '../lib/useShellLayout';
import type { AuthState } from '../lib/types';

export function Messages({ auth }: { auth: AuthState }) {
  const { teamId } = useParams();
  const { isDesktopWeb } = useShellLayout();
  const activeTeam = teamId ? mockTeams.find((team) => team.id === teamId) : undefined;

  if (isDesktopWeb) {
    return <DesktopMessages auth={auth} activeTeamId={activeTeam?.id} />;
  }

  if (activeTeam) {
    return <ChatWindow auth={auth} teamId={activeTeam.id} teamName={activeTeam.name} />;
  }

  return (
    <div className="messages-page space-y-4">
      <MessagesHeader />
      <MessageList />
    </div>
  );
}

function DesktopMessages({ auth, activeTeamId }: { auth: AuthState; activeTeamId?: string }) {
  const selectedTeam = activeTeamId ? mockTeams.find((team) => team.id === activeTeamId) : mockTeams[0];

  return (
    <div className="messages-page messages-page-web space-y-4">
      <MessagesHeader />
      <section className="messages-two-pane">
        <div className="messages-list-pane">
          <MessageList activeTeamId={selectedTeam?.id} compact />
        </div>
        <div className="min-w-0">
          {selectedTeam ? (
            <ChatWindow auth={auth} teamId={selectedTeam.id} teamName={selectedTeam.name} embedded />
          ) : (
            <div className="app-card p-6 text-sm font-semibold text-gray-600">Select a team chat.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function MessagesHeader() {
  return (
    <section className="messages-header app-card p-4">
      <div className="app-label">Messages</div>
      <h1 className="mt-1 text-2xl font-black text-gray-950">Team chats</h1>
      <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
        Opens directly to team conversations, unread state, and a simple reply path. Advanced tools stay attached to the message they affect.
      </p>
    </section>
  );
}

function MessageList({ activeTeamId = '', compact = false }: { activeTeamId?: string; compact?: boolean }) {
  return (
    <section className={compact ? 'space-y-2' : 'space-y-3'}>
      {mockMessages.map((message) => {
        const active = activeTeamId === message.teamId;
        return (
          <Link
            key={message.teamId}
            to={`/messages/${message.teamId}`}
            className={`app-card flex items-center gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg ${
              active ? '!border-primary-200 bg-primary-50/40' : ''
            }`}
          >
            <div className="relative flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <MessageCircle className="h-6 w-6" aria-hidden="true" />
              {message.unreadCount ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                  {message.unreadCount}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-base font-black text-gray-950">{message.teamName}</div>
                <div className="flex-none text-xs font-bold text-gray-500">{message.timeLabel}</div>
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-gray-600">
                <span className="font-black text-gray-700">{message.senderName}:</span> {message.lastMessage}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
          </Link>
        );
      })}
    </section>
  );
}

function ChatWindow({ auth, teamId, teamName, embedded = false }: { auth: AuthState; teamId: string; teamName: string; embedded?: boolean }) {
  const [activeMessageActionsId, setActiveMessageActionsId] = useState<string | null>(null);
  const preview = mockMessages.find((message) => message.teamId === teamId);

  useEffect(() => {
    setActiveMessageActionsId(null);
  }, [teamId]);

  const messages = [
    { id: '1', sender: 'Coach Jamie', body: preview?.lastMessage || 'Welcome to the team chat.', time: '8:12 AM', mine: false },
    { id: '2', sender: auth.user?.displayName || 'Me', body: 'We can help with snacks and scorebook.', time: '8:18 AM', mine: true },
    { id: '3', sender: 'ALL PLAYS AI', body: '@assistant can summarize missing RSVPs when the live integration is connected.', time: '8:21 AM', mine: false }
  ];

  return (
    <div className={`chat-window space-y-4 ${embedded ? 'chat-window-embedded' : ''}`}>
      <section className={`${embedded ? '' : 'sticky top-[69px] z-20'} rounded-2xl border border-gray-200 bg-white p-3 shadow-app`}>
        <div className="flex items-center gap-3">
          <Link to="/messages" className={`ghost-button !h-10 !min-h-10 !w-10 !p-0 ${embedded ? 'hidden' : ''}`} aria-label="Back to messages">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-black text-gray-950">{teamName}</div>
            <div className="truncate text-xs font-bold text-gray-500">Team chat · conversations · moderation-ready</div>
          </div>
          {auth.isCoach || auth.isAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.04em] text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Staff
            </span>
          ) : null}
        </div>
      </section>

      <section className="app-card p-4">
        <div className="space-y-3">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${message.mine ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                <div className={`text-[11px] font-extrabold uppercase tracking-[0.04em] ${message.mine ? 'text-primary-100' : 'text-gray-500'}`}>{message.sender}</div>
                <div className="mt-1 text-sm font-semibold leading-6">{message.body}</div>
                <div className={`mt-1 flex items-center justify-between gap-3 text-[11px] font-bold ${message.mine ? 'text-primary-100' : 'text-gray-500'}`}>
                  <span>{message.time}</span>
                  <button
                    type="button"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${message.mine ? 'text-white/90 hover:bg-white/15' : 'text-gray-600 hover:bg-gray-200'}`}
                    aria-expanded={activeMessageActionsId === message.id}
                    aria-label={`Message actions for ${message.sender}`}
                    onClick={() => setActiveMessageActionsId((currentId) => currentId === message.id ? null : message.id)}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {activeMessageActionsId === message.id ? (
                  <div className={`mt-2 flex flex-wrap gap-2 ${message.mine ? 'justify-end' : 'justify-start'}`} aria-label={`Advanced actions for ${message.sender}`}>
                    <MessageActionButton icon={Bot} label="AI" mine={message.mine} />
                    <MessageActionButton icon={Smile} label="React" mine={message.mine} />
                    <MessageActionButton icon={Edit3} label="Edit" mine={message.mine} />
                    <MessageActionButton icon={Trash2} label="Delete" mine={message.mine} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <form className="app-card flex items-center gap-2 p-3" onSubmit={(event) => event.preventDefault()}>
        <button type="button" className="ghost-button !h-11 !min-h-11 !w-11 !p-0" aria-label="Add attachment">
          <Paperclip className="h-5 w-5" aria-hidden="true" />
        </button>
        <input className="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-base font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" placeholder={`Message ${teamName}`} />
        <button type="submit" className="primary-button !h-11 !min-h-11 !w-11 !p-0" aria-label="Send message">
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function MessageActionButton({ icon: Icon, label, mine }: { icon: typeof Bot; label: string; mine: boolean }) {
  return (
    <button type="button" className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-xs font-black ${mine ? 'border-white/20 bg-white/10 text-white hover:bg-white/20' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200 hover:text-primary-700'}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
