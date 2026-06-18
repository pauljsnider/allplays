// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageAvatar, StatusBanner, TeamAvatar } from './Messages';

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    Archive: Icon,
    BellOff: Icon,
    Bot: Icon,
    Camera: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Copy: Icon,
    Download: Icon,
    Edit3: Icon,
    ImageIcon: Icon,
    Link2: Icon,
    Loader2: Icon,
    Mail: Icon,
    MessageCircle: Icon,
    Mic: Icon,
    MoreVertical: Icon,
    Paperclip: Icon,
    RefreshCw: Icon,
    Search: Icon,
    Send: Icon,
    Share2: Icon,
    ShieldCheck: Icon,
    Smile: Icon,
    Trash2: Icon,
    Users: Icon,
    Video: Icon,
    X: Icon
  };
});

describe('Messages accessibility helpers', () => {
  it('gives team avatars meaningful alt text', () => {
    render(<TeamAvatar team={{ name: 'Bears', photoUrl: 'https://example.com/team.jpg', unreadCount: 2 }} />);

    expect(screen.getByAltText('Bears team photo')).toBeTruthy();
  });

  it('gives sender avatars meaningful alt text', () => {
    render(
      <MessageAvatar
        label="Coach Jamie"
        message={{
          id: 'msg-1',
          text: 'See you at practice',
          senderId: 'coach-1',
          senderName: 'Coach Jamie',
          senderPhotoUrl: 'https://example.com/coach.jpg',
          reactions: {},
          deleted: false,
          createdAt: new Date('2026-06-18T04:00:00Z')
        } as any}
      />
    );

    expect(screen.getByAltText('Coach Jamie profile photo')).toBeTruthy();
  });

  it('announces error banners as alerts', () => {
    render(<StatusBanner status={{ tone: 'error', message: 'Failed to send message.' }} onClose={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to send message.');
  });
});
