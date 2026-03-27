import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    MAX_CHAT_MEDIA_SIZE,
    normalizeChatAttachments,
    collectThreadMedia,
    buildChatMediaShareDetails,
    getChatMediaActionState,
    getChatMediaDownloadName
} from '../../js/team-chat-media.js';

describe('team chat media normalization', () => {
    it('normalizes mixed image and video attachments and preserves the first image as legacy media', () => {
        const result = normalizeChatAttachments([
            {
                url: 'https://cdn.example.com/video.mp4',
                path: 'team-photos/video.mp4',
                name: 'video.mp4',
                type: 'video/mp4',
                size: 2048
            },
            {
                url: 'https://cdn.example.com/photo.jpg',
                path: 'team-photos/photo.jpg',
                name: 'photo.jpg',
                type: 'image/jpeg',
                size: 1024
            }
        ]);

        expect(result.attachments).toEqual([
            {
                type: 'video',
                url: 'https://cdn.example.com/video.mp4',
                path: 'team-photos/video.mp4',
                thumbnailUrl: null,
                name: 'video.mp4',
                mimeType: 'video/mp4',
                size: 2048,
                uploadedAt: null
            },
            {
                type: 'image',
                url: 'https://cdn.example.com/photo.jpg',
                path: 'team-photos/photo.jpg',
                thumbnailUrl: null,
                name: 'photo.jpg',
                mimeType: 'image/jpeg',
                size: 1024,
                uploadedAt: null
            }
        ]);

        expect(result.legacyImage).toEqual({
            imageUrl: 'https://cdn.example.com/photo.jpg',
            imagePath: 'team-photos/photo.jpg',
            imageName: 'photo.jpg',
            imageType: 'image/jpeg',
            imageSize: 1024
        });
    });

    it('rejects unsupported files and files larger than the chat media limit', () => {
        expect(() => normalizeChatAttachments([
            { url: 'https://cdn.example.com/file.pdf', type: 'application/pdf', size: 123 }
        ])).toThrow(/image or video/i);

        expect(() => normalizeChatAttachments([
            { url: 'https://cdn.example.com/huge.mp4', type: 'video/mp4', size: MAX_CHAT_MEDIA_SIZE + 1 }
        ])).toThrow(/5MB or smaller/i);
    });
});

describe('team chat media gallery', () => {
    it('collects newest valid media across messages and skips deleted or unsafe entries', () => {
        const media = collectThreadMedia([
            {
                id: 'msg-1',
                deleted: false,
                createdAt: { toDate: () => new Date('2026-03-09T20:00:00Z') },
                senderName: 'Coach',
                attachments: [
                    { type: 'image', url: 'https://cdn.example.com/a.jpg', name: 'a.jpg', size: 1200 },
                    { type: 'video', url: 'javascript:alert(1)', name: 'bad.mp4', size: 800 }
                ]
            },
            {
                id: 'msg-2',
                deleted: true,
                createdAt: { toDate: () => new Date('2026-03-09T20:01:00Z') },
                attachments: [
                    { type: 'image', url: 'https://cdn.example.com/b.jpg', name: 'b.jpg', size: 1200 }
                ]
            },
            {
                id: 'msg-3',
                deleted: false,
                createdAt: { toDate: () => new Date('2026-03-09T20:02:00Z') },
                senderName: 'Parent',
                imageUrl: 'https://cdn.example.com/legacy.jpg',
                imageName: 'legacy.jpg'
            }
        ]);

        expect(media.map((entry) => ({
            messageId: entry.messageId,
            type: entry.type,
            url: entry.url,
            senderName: entry.senderName
        }))).toEqual([
            {
                messageId: 'msg-3',
                type: 'image',
                url: 'https://cdn.example.com/legacy.jpg',
                senderName: 'Parent'
            },
            {
                messageId: 'msg-1',
                type: 'image',
                url: 'https://cdn.example.com/a.jpg',
                senderName: 'Coach'
            }
        ]);
    });

    it('builds share details, action availability, and download names for gallery items', () => {
        const entry = {
            type: 'video',
            url: 'https://cdn.example.com/highlight.mp4',
            name: 'Varsity Finals Clip.mp4',
            senderName: 'Coach Kim',
            createdAt: new Date('2026-03-09T20:02:00Z')
        };

        expect(buildChatMediaShareDetails(entry)).toEqual({
            title: 'Team chat video',
            text: 'Shared by Coach Kim on Mar 9, 2026',
            url: 'https://cdn.example.com/highlight.mp4'
        });

        expect(getChatMediaActionState(entry, {
            canNativeShare: true,
            canCopyLink: true
        })).toEqual({
            canShare: true,
            canDownload: true,
            canCopyLink: true
        });

        expect(getChatMediaActionState(entry, {
            canNativeShare: false,
            canCopyLink: false
        })).toEqual({
            canShare: false,
            canDownload: true,
            canCopyLink: false
        });

        expect(getChatMediaDownloadName(entry)).toBe('Varsity_Finals_Clip.mp4');
        expect(getChatMediaDownloadName({
            type: 'image',
            url: 'https://cdn.example.com/media',
            name: '',
            createdAt: new Date('2026-03-09T20:02:00Z')
        })).toBe('team-chat-photo-2026-03-09.jpg');
    });
});

describe('team chat help copy', () => {
    it('advertises multiple photo and video attachments in workflow help', () => {
        const repoRoot = path.resolve(import.meta.dirname, '../..');
        const workflowHtml = fs.readFileSync(path.join(repoRoot, 'workflow-communication.html'), 'utf8');
        const manifest = fs.readFileSync(path.join(repoRoot, 'workflow-manifest.json'), 'utf8');

        expect(workflowHtml).toContain('attach photos or short videos (up to 5 MB each)');
        expect(manifest).toContain('attach photos or short videos (up to 5 MB each)');
    });
});
