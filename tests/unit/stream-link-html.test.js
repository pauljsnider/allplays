
import { describe, it, expect } from 'vitest';
import { streamLinkHtml } from '../../js/stream-link-html.js'; // Will create this file

describe('streamLinkHtml', () => {
    it('should return a YouTube link for a standard embed URL', () => {
        const team = {
            youtubeEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on YouTube\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });

    it('should return a YouTube link for an embed URL without the domain prefix', () => {
        const team = {
            youtubeEmbedUrl: '/embed/dQw4w9WgXcQ'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on YouTube\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });

    it('should return an empty string if no embed URL is provided', () => {
        const team = {};
        expect(streamLinkHtml(team)).toEqual('');
    });

    it('should return a Twitch link if twitchChannel is provided', () => {
        const team = {
            twitchChannel: 'mychannel'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://twitch.tv/mychannel">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on Twitch\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });

    it('should prioritize Twitch over YouTube if both are provided', () => {
        const team = {
            twitchChannel: 'mychannel',
            youtubeEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://twitch.tv/mychannel">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on Twitch\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });

    it('should return a YouTube channel link for a channel embed URL', () => {
        const team = {
            youtubeEmbedUrl: 'https://www.youtube.com/channel/UC_a_channel_id_here'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/channel/UC_a_channel_id_here">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on YouTube\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });

    it('should return a YouTube channel link for an embed URL with channel query parameter', () => {
        const team = {
            youtubeEmbedUrl: 'https://www.youtube.com/embed?channel=UC_a_channel_id_here'
        };
        const expected = '<a class="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 font-medium transition" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/channel/UC_a_channel_id_here">\n                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>\n                    Watch on YouTube\n                </a>';
        expect(streamLinkHtml(team)).toEqual(expected);
    });
});
