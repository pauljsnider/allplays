import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Mail, Mic, MoreHorizontal, Paperclip, Send, Users, X } from 'lucide-react';
import { getChatMentionInsertion, hasAllPlaysMention, type ChatMentionSuggestion } from '../../../lib/chatLogic';

type FilePreview = {
    file: File;
    url: string;
};

export function Composer({
    teamName,
    text,
    filePreviews,
    sending,
    composerNotice,
    aiThinking,
    voiceListening,
    voiceSupported,
    canModerate,
    canSendTeamEmail,
    mentionSuggestions,
    mentionSuggestionsLoading,
    mentionTriggerActive,
    audienceSummary,
    disabled = false,
    onCursorChange,
    onTextChange,
    onSubmit,
    onAttach,
    onRemoveFile,
    onVoice,
    onAudience,
    onTeamEmail,
    onMention,
    onRecipientMention
}: {
    teamName: string;
    text: string;
    filePreviews: FilePreview[];
    sending: boolean;
    composerNotice: string;
    aiThinking: boolean;
    voiceListening: boolean;
    voiceSupported: boolean;
    canModerate: boolean;
    canSendTeamEmail: boolean;
    mentionSuggestions: ChatMentionSuggestion[];
    mentionSuggestionsLoading: boolean;
    mentionTriggerActive: boolean;
    audienceSummary: string;
    disabled?: boolean;
    onCursorChange: (cursorPosition: number | undefined) => void;
    onTextChange: (value: string) => void;
    onSubmit: (event?: FormEvent) => void;
    onAttach: () => void;
    onRemoveFile: (index: number) => void;
    onVoice: () => void;
    onAudience: () => void;
    onTeamEmail: () => void;
    onMention: () => void;
    onRecipientMention: (mentionLabel: string, cursorPosition?: number) => void;
}) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const pendingCursorPositionRef = useRef<number | null>(null);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
    const [showStaffActions, setShowStaffActions] = useState(false);
    const canSend = Boolean(text.trim() || filePreviews.length) && !aiThinking && !disabled;
    const hasStaffActions = canModerate || canSendTeamEmail;
    const cursorPosition = textareaRef.current?.selectionStart ?? text.length;
    const beforeCursor = useMemo(() => text.slice(0, cursorPosition), [cursorPosition, text]);
    const showMentionQuickAction = /(^|\s)@\w*$/i.test(beforeCursor) && !hasAllPlaysMention(text);
    const showMentionSuggestions = mentionTriggerActive && !hasAllPlaysMention(text) && (mentionSuggestionsLoading || mentionSuggestions.length > 0);
    const placeholder = teamName.length > 16 ? 'Message' : `Message ${teamName}`;
    const attachmentSummary = filePreviews.length
        ? `${filePreviews.length} attachment${filePreviews.length === 1 ? '' : 's'} ready`
        : '';
    const notice = composerNotice || attachmentSummary;

    useEffect(() => {
        setActiveSuggestionIndex((current) => {
            if (!mentionSuggestions.length) return 0;
            return Math.min(current, mentionSuggestions.length - 1);
        });
    }, [mentionSuggestions]);

    useEffect(() => {
        if (pendingCursorPositionRef.current === null) return;
        const textarea = textareaRef.current;
        if (!textarea) return;
        const nextCursorPosition = Math.min(pendingCursorPositionRef.current, text.length);
        textarea.focus();
        textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
        onCursorChange(nextCursorPosition);
        pendingCursorPositionRef.current = null;
    }, [onCursorChange, text]);

    useEffect(() => {
        if (disabled || !hasStaffActions) setShowStaffActions(false);
    }, [disabled, hasStaffActions]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleNativeSelect = () => {
            onCursorChange(textarea.selectionStart ?? textarea.value.length);
        };

        textarea.addEventListener('select', handleNativeSelect);
        return () => textarea.removeEventListener('select', handleNativeSelect);
    }, [onCursorChange]);

    const syncCursorPosition = (nextCursorPosition = textareaRef.current?.selectionStart ?? text.length) => {
        onCursorChange(nextCursorPosition);
        return nextCursorPosition;
    };

    const applyRecipientMention = (mentionLabel: string) => {
        const nextCursorPosition = syncCursorPosition();
        pendingCursorPositionRef.current = getChatMentionInsertion(text, mentionLabel, nextCursorPosition).cursorPosition;
        onRecipientMention(mentionLabel, nextCursorPosition);
        setActiveSuggestionIndex(0);
    };

    const runStaffAction = (action: () => void) => {
        setShowStaffActions(false);
        action();
    };

    return (
        <form
            className="chat-composer safe-bottom border border-gray-200 bg-white p-2 shadow-app"
            onSubmit={(event) => {
                if (disabled) {
                    event.preventDefault();
                    return;
                }
                onSubmit(event);
            }}
            aria-disabled={disabled}
        >
            {filePreviews.length ? (
                <div className="chat-attachment-strip">
                    {filePreviews.map((preview, index) => (
                        <div key={preview.url} className="relative h-12 w-12 flex-none overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                            {preview.file.type.startsWith('video/') ? (
                                <video src={preview.url} className="h-full w-full object-cover" muted playsInline />
                            ) : (
                                <img src={preview.url} alt={preview.file.name || `Attachment preview ${index + 1}`} className="h-full w-full object-cover" />
                            )}
                            <button type="button" className="absolute right-1 top-1 rounded-full bg-gray-950/70 p-1 text-white" onClick={() => onRemoveFile(index)} aria-label="Remove attachment" disabled={disabled}>
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            {showMentionQuickAction && !disabled ? (
                <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-sm font-black text-indigo-700" onMouseDown={(event) => event.preventDefault()} onClick={onMention}>
                    <Bot className="h-4 w-4" aria-hidden="true" />
                    @ALL PLAYS
                </button>
            ) : null}

            {showMentionSuggestions && !disabled ? (
                <div className="mb-2 rounded-xl border border-gray-200 bg-white p-1 shadow-sm" aria-label="Mention suggestions">
                    {mentionSuggestionsLoading && mentionSuggestions.length === 0 ? (
                        <div className="px-3 py-2 text-xs font-bold text-gray-500">Loading teammates...</div>
                    ) : mentionSuggestions.map((suggestion, index) => {
                        const active = index === activeSuggestionIndex;
                        return (
                            <button
                                key={suggestion.id}
                                type="button"
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${active ? 'bg-primary-50' : 'hover:bg-primary-50'}`}
                                aria-selected={active}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => applyRecipientMention(suggestion.label)}
                            >
                                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary-50 text-xs font-black text-primary-700">
                                    {suggestion.label.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-black text-gray-950">@{suggestion.label}</span>
                                    {suggestion.detail ? <span className="block truncate text-xs font-semibold text-gray-500">{suggestion.detail}</span> : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="chat-composer-input-shell">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(event) => {
                        if (disabled) return;
                        onTextChange(event.target.value);
                        onCursorChange(event.target.selectionStart ?? event.target.value.length);
                    }}
                    onClick={(event) => {
                        if (!disabled) syncCursorPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                    }}
                    onKeyUp={(event) => {
                        if (!disabled) syncCursorPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                    }}
                    onSelect={(event) => {
                        if (!disabled) syncCursorPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                    }}
                    rows={1}
                    maxLength={2000}
                    className="chat-composer-textarea"
                    placeholder={placeholder}
                    disabled={disabled}
                    enterKeyHint="send"
                    onKeyDown={(event) => {
                        if (showMentionSuggestions && mentionSuggestions.length > 0) {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveSuggestionIndex((current) => (current + 1) % mentionSuggestions.length);
                                return;
                            }
                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveSuggestionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                                return;
                            }
                            if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                                event.preventDefault();
                                applyRecipientMention(mentionSuggestions[activeSuggestionIndex]?.label || mentionSuggestions[0].label);
                                return;
                            }
                        }
                        if (!disabled && event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            onSubmit();
                        }
                    }}
                />
                <button type="submit" className="chat-composer-send primary-button" disabled={!canSend} aria-label="Send message">
                    {aiThinking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
                </button>
            </div>

            {notice ? (
                <div className="chat-composer-notice" aria-live="polite">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span className="truncate">{notice}</span>
                </div>
            ) : null}

            <div className="chat-composer-toolbar">
                <button type="button" className="chat-tool-button" onClick={onAttach} aria-label="Add attachment" disabled={disabled}>
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                </button>
                {voiceSupported ? (
                    <button
                        type="button"
                        className={`chat-tool-button ${voiceListening ? 'chat-tool-button-active' : ''}`}
                        onClick={onVoice}
                        aria-label={voiceListening ? 'Stop voice input' : 'Voice to text'}
                        disabled={disabled}
                    >
                        <Mic className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
                {hasStaffActions ? (
                    <button
                        type="button"
                        className="chat-tool-button"
                        onClick={() => setShowStaffActions((current) => !current)}
                        aria-label="Open staff actions"
                        aria-expanded={showStaffActions}
                        aria-controls="chat-staff-actions"
                        disabled={disabled}
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
            </div>

            {showStaffActions && !disabled ? (
                <div id="chat-staff-actions" className="chat-staff-actions-menu" role="menu" aria-label="Staff actions">
                    <div className="chat-staff-actions-heading">Staff actions</div>
                    {canModerate ? (
                        <button type="button" className="chat-staff-action-button" role="menuitem" onClick={() => runStaffAction(onAudience)}>
                            <Users className="h-4 w-4 flex-none" aria-hidden="true" />
                            <span className="min-w-0 text-left">
                                <span className="block text-sm font-black text-gray-950">Message audience</span>
                                <span className="block truncate text-xs font-bold text-gray-500">Current: {audienceSummary}</span>
                            </span>
                        </button>
                    ) : null}
                    {canSendTeamEmail ? (
                        <button type="button" className="chat-staff-action-button" role="menuitem" onClick={() => runStaffAction(onTeamEmail)}>
                            <Mail className="h-4 w-4 flex-none" aria-hidden="true" />
                            <span className="text-sm font-black text-gray-950">Team Email</span>
                        </button>
                    ) : null}
                </div>
            ) : null}
        </form>
    );
}
