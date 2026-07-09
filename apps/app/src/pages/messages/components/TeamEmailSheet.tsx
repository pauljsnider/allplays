import { FormEvent, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import {
  loadSentTeamEmails,
  loadTeamEmailDrafts,
  loadTeamEmailTemplates,
  saveTeamEmailDraft,
  saveTeamEmailTemplate,
  sendTeamEmailMessage,
  type ChatConversation,
  type SentTeamEmail,
  type TeamEmailDraft,
  type TeamEmailTemplate
} from '../../../lib/chatService';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  buildEmailAudienceMetadata,
  formatChatDay,
  formatChatTime,
  getAudienceSummaryText,
  isDefaultTeamConversation,
  type ChatAudienceMetadata,
  type ChatRecipientOption,
  type ChatTargetType
} from '../../../lib/chatLogic';
import type { AuthState } from '../../../lib/types';
import { emailComposerActions, emailReducer, initialEmailComposerState } from '../state/emailReducer';
import { Sheet, StatusBanner } from './ChatWindow';

type StatusTone = 'neutral' | 'success' | 'error';

type ChatStatus = {
  tone: StatusTone;
  message: string;
};

type TeamEmailSheetProps = {
  open: boolean;
  auth: AuthState;
  teamId: string;
  profile: Record<string, any>;
  isDesktopWeb: boolean;
  selectedConversation: ChatConversation | null;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
  recipientOptions: ChatRecipientOption[];
  recipientOptionsLoading: boolean;
  recipientOptionsError: string | null;
  ensureRecipientOptionsLoaded: () => Promise<ChatRecipientOption[]>;
  setSelectedRecipientTarget: (target: ChatTargetType) => void;
  setSelectedRecipientIds: (recipientIds: string[]) => void;
  switchConversation: (conversationId: string) => void | boolean;
  onClose: () => void;
};

export default function TeamEmailSheet({
  open,
  auth,
  teamId,
  profile,
  isDesktopWeb,
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds,
  recipientOptions,
  recipientOptionsLoading,
  recipientOptionsError,
  ensureRecipientOptionsLoaded,
  setSelectedRecipientTarget,
  setSelectedRecipientIds,
  switchConversation,
  onClose
}: TeamEmailSheetProps) {
  const [emailState, emailDispatch] = useReducer(emailReducer, initialEmailComposerState);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSavingTemplate, setEmailSavingTemplate] = useState(false);
  const [emailSavingDraft, setEmailSavingDraft] = useState(false);
  const [emailLoadingDrafts, setEmailLoadingDrafts] = useState(false);
  const [emailLoadingHistory, setEmailLoadingHistory] = useState(false);
  const [emailLoadingTemplates, setEmailLoadingTemplates] = useState(false);
  const [emailStatus, setEmailStatus] = useState<ChatStatus | null>(null);
  const [emailHistoryStatus, setEmailHistoryStatus] = useState<ChatStatus | null>(null);
  const [sentEmails, setSentEmails] = useState<SentTeamEmail[]>([]);
  const loadedForTeamRef = useRef<string | null>(null);
  const openForTeamRef = useRef<string | null>(null);

  const emailAudienceMetadata = useMemo(() => buildEmailAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds,
    recipientOptions
  }), [recipientOptions, selectedConversation, selectedConversationId, selectedRecipientIds, selectedRecipientTarget]);
  const audienceSummary = useMemo(
    () => getAudienceSummaryText(emailAudienceMetadata, recipientOptions),
    [emailAudienceMetadata, recipientOptions]
  );

  const reloadSentEmailHistory = async ({ suppressErrorStatus = false } = {}) => {
    setEmailLoadingHistory(true);
    try {
      setSentEmails(await loadSentTeamEmails(teamId, { limit: 25 }));
      setEmailHistoryStatus(null);
    } catch (historyError: any) {
      if (!suppressErrorStatus) {
        setEmailHistoryStatus({ tone: 'error', message: historyError?.message || 'Could not load sent email history.' });
      }
    } finally {
      setEmailLoadingHistory(false);
    }
  };

  const reloadEmailTemplates = async ({ suppressErrorStatus = false } = {}) => {
    setEmailLoadingTemplates(true);
    try {
      emailDispatch(emailComposerActions.setTemplates(await loadTeamEmailTemplates(teamId)));
      if (!suppressErrorStatus) {
        setEmailStatus(null);
      }
    } catch (templateError: any) {
      if (!suppressErrorStatus) {
        setEmailStatus({ tone: 'error', message: templateError?.message || 'Could not load team email templates.' });
      }
    } finally {
      setEmailLoadingTemplates(false);
    }
  };

  const reloadEmailDrafts = async ({ suppressErrorStatus = false } = {}) => {
    setEmailLoadingDrafts(true);
    try {
      emailDispatch(emailComposerActions.setDrafts(await loadTeamEmailDrafts(teamId)));
      if (!suppressErrorStatus) {
        setEmailStatus(null);
      }
    } catch (draftError: any) {
      if (!suppressErrorStatus) {
        setEmailStatus({ tone: 'error', message: draftError?.message || 'Could not load saved drafts.' });
      }
    } finally {
      setEmailLoadingDrafts(false);
    }
  };

  useEffect(() => {
    if (!open) {
      openForTeamRef.current = null;
      return;
    }
    if (openForTeamRef.current !== teamId) {
      openForTeamRef.current = teamId;
      emailDispatch(emailComposerActions.updateTemplateName(''));
      emailDispatch(emailComposerActions.clearSelectedDraft());
      setEmailStatus(null);
      setEmailHistoryStatus(null);
    }
    void ensureRecipientOptionsLoaded().catch(() => undefined);
    if (loadedForTeamRef.current === teamId) return;
    loadedForTeamRef.current = teamId;
    void reloadEmailDrafts();
    void reloadEmailTemplates();
    void reloadSentEmailHistory();
  }, [ensureRecipientOptionsLoaded, open, teamId]);

  const handleApplyEmailDraft = (draftId: string) => {
    const draft = emailState.drafts.find((item) => item.id === draftId);
    if (!draft) return;
    if (!isDefaultTeamConversation(selectedConversationId)) {
      switchConversation(DEFAULT_TEAM_CONVERSATION_ID);
    }
    setSelectedRecipientTarget('individuals');
    setSelectedRecipientIds(draft.recipientIds);
    emailDispatch(emailComposerActions.selectDraft(draft.id));
    setEmailStatus({ tone: 'success', message: `Restored draft "${draft.subject || 'Untitled draft'}". This replaced the current email composer.` });
  };

  const handleApplyEmailTemplate = (templateId: string) => {
    const template = emailState.templates.find((item) => item.id === templateId);
    if (!template) return;
    emailDispatch(emailComposerActions.applyTemplate(template.id));
    setEmailStatus({ tone: 'success', message: `Applied template "${template.name}".` });
  };

  const handleSaveEmailTemplate = async () => {
    if (emailSavingTemplate) return;
    setEmailSavingTemplate(true);
    setEmailStatus({ tone: 'neutral', message: 'Saving team email template...' });
    try {
      const savedTemplate = await saveTeamEmailTemplate({
        teamId,
        name: emailState.templateName,
        subject: emailState.subject,
        body: emailState.body
      });
      emailDispatch(emailComposerActions.updateTemplateName(''));
      emailDispatch(emailComposerActions.setTemplates([savedTemplate, ...emailState.templates.filter((item) => item.id !== savedTemplate.id)]));
      setEmailStatus({ tone: 'success', message: `Saved template "${savedTemplate.name}".` });
      void reloadEmailTemplates({ suppressErrorStatus: true });
    } catch (saveError: any) {
      setEmailStatus({ tone: 'error', message: saveError?.message || 'Could not save team email template.' });
    } finally {
      setEmailSavingTemplate(false);
    }
  };

  const handleSaveEmailDraft = async () => {
    if (emailSavingDraft) return;
    setEmailSavingDraft(true);
    setEmailStatus({ tone: 'neutral', message: 'Saving team email draft...' });
    try {
      const savedDraft = await saveTeamEmailDraft({
        teamId,
        draftId: emailState.selectedDraftId || null,
        subject: emailState.subject,
        body: emailState.body,
        recipientIds: emailAudienceMetadata.recipientIds,
        recipientOptions,
        authorId: auth.user?.uid || null,
        authorEmail: auth.user?.email || null,
        authorName: profile?.fullName || auth.user?.displayName || null
      });
      if (savedDraft?.id) {
        emailDispatch(emailComposerActions.saveDraft(savedDraft));
      }
      setEmailStatus({ tone: 'success', message: `Saved draft "${savedDraft?.subject || emailState.subject || 'Untitled draft'}". No email was sent.` });
      void reloadEmailDrafts({ suppressErrorStatus: true });
    } catch (saveError: any) {
      setEmailStatus({ tone: 'error', message: saveError?.message || 'Could not save team email draft.' });
    } finally {
      setEmailSavingDraft(false);
    }
  };

  const handleSendEmail = async (event?: FormEvent) => {
    event?.preventDefault();
    if (emailSending) return;
    const subject = emailState.subject.trim();
    const body = emailState.body.trim();
    if (!subject || !body) {
      setEmailStatus({ tone: 'error', message: 'Subject and message are required.' });
      return;
    }
    if (emailAudienceMetadata.targetType === 'individuals' && emailAudienceMetadata.recipientIds.length === 0) {
      setEmailStatus({ tone: 'error', message: 'Choose at least one selected member before sending.' });
      return;
    }

    setEmailSending(true);
    setEmailStatus({ tone: 'neutral', message: 'Creating backend mail jobs...' });
    try {
      const result = await sendTeamEmailMessage({
        teamId,
        subject,
        body,
        targetType: emailAudienceMetadata.targetType,
        recipientIds: emailAudienceMetadata.recipientIds
      });
      emailDispatch(emailComposerActions.clearComposer());
      setEmailStatus({ tone: 'success', message: `Queued ${Number(result?.recipientCount || 0)} recipient${Number(result?.recipientCount || 0) === 1 ? '' : 's'} for backend email delivery.` });
      await reloadSentEmailHistory({ suppressErrorStatus: true });
    } catch (sendError: any) {
      setEmailStatus({ tone: 'error', message: sendError?.message || 'Email send failed. Nothing was silently dropped.' });
    } finally {
      setEmailSending(false);
    }
  };

  if (!open) return null;

  return (
    <TeamEmailSheetView
      isDesktopWeb={isDesktopWeb}
      subject={emailState.subject}
      body={emailState.body}
      drafts={emailState.drafts}
      selectedDraftId={emailState.selectedDraftId}
      templateName={emailState.templateName}
      savingDraft={emailSavingDraft}
      loadingDrafts={emailLoadingDrafts}
      templates={emailState.templates}
      sending={emailSending}
      savingTemplate={emailSavingTemplate}
      loadingHistory={emailLoadingHistory}
      loadingTemplates={emailLoadingTemplates}
      recipientOptionsLoading={recipientOptionsLoading}
      recipientOptionsError={recipientOptionsError}
      status={emailStatus}
      historyStatus={emailHistoryStatus}
      sentEmails={sentEmails}
      audienceSummary={audienceSummary}
      audienceMetadata={emailAudienceMetadata}
      onSubjectChange={(subject) => emailDispatch(emailComposerActions.updateSubject(subject))}
      onBodyChange={(body) => emailDispatch(emailComposerActions.updateBody(body))}
      onTemplateNameChange={(templateName) => emailDispatch(emailComposerActions.updateTemplateName(templateName))}
      onApplyDraft={handleApplyEmailDraft}
      onSaveDraft={handleSaveEmailDraft}
      onApplyTemplate={handleApplyEmailTemplate}
      onSaveTemplate={handleSaveEmailTemplate}
      onSubmit={handleSendEmail}
      onRefreshDrafts={reloadEmailDrafts}
      onRefreshHistory={reloadSentEmailHistory}
      onRefreshTemplates={reloadEmailTemplates}
      onRetryRecipientOptions={() => {
        void ensureRecipientOptionsLoaded().catch(() => undefined);
      }}
      onStatusClose={() => setEmailStatus(null)}
      onHistoryStatusClose={() => setEmailHistoryStatus(null)}
      onClose={onClose}
    />
  );
}

function TeamEmailSheetView({
  isDesktopWeb,
  subject,
  body,
  drafts,
  selectedDraftId,
  templateName,
  savingDraft,
  loadingDrafts,
  templates,
  sending,
  savingTemplate,
  loadingHistory,
  loadingTemplates,
  recipientOptionsLoading,
  recipientOptionsError,
  status,
  historyStatus,
  sentEmails,
  audienceSummary,
  audienceMetadata,
  onSubjectChange,
  onBodyChange,
  onTemplateNameChange,
  onApplyDraft,
  onSaveDraft,
  onApplyTemplate,
  onSaveTemplate,
  onSubmit,
  onRefreshDrafts,
  onRefreshHistory,
  onRefreshTemplates,
  onRetryRecipientOptions,
  onStatusClose,
  onHistoryStatusClose,
  onClose
}: {
  isDesktopWeb: boolean;
  subject: string;
  body: string;
  drafts: TeamEmailDraft[];
  selectedDraftId: string;
  templateName: string;
  savingDraft: boolean;
  loadingDrafts: boolean;
  templates: TeamEmailTemplate[];
  sending: boolean;
  savingTemplate: boolean;
  loadingHistory: boolean;
  loadingTemplates: boolean;
  recipientOptionsLoading: boolean;
  recipientOptionsError: string | null;
  status: ChatStatus | null;
  historyStatus: ChatStatus | null;
  sentEmails: SentTeamEmail[];
  audienceSummary: string;
  audienceMetadata: ChatAudienceMetadata;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onApplyDraft: (draftId: string) => void;
  onSaveDraft: () => void;
  onApplyTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onSubmit: (event?: FormEvent) => void;
  onRefreshDrafts: () => void;
  onRefreshHistory: () => void;
  onRefreshTemplates: () => void;
  onRetryRecipientOptions: () => void;
  onStatusClose: () => void;
  onHistoryStatusClose: () => void;
  onClose: () => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const draftAudienceSupported = audienceMetadata.targetType === 'individuals';
  const missingSelectedRecipients = audienceMetadata.targetType === 'individuals' && audienceMetadata.recipientIds.length === 0;
  const canSendEmail = Boolean(subject.trim() && body.trim()) && !missingSelectedRecipients && !sending;
  const canSaveDraft = draftAudienceSupported
    && !recipientOptionsLoading
    && !recipientOptionsError
    && Boolean(subject.trim() && body.trim())
    && !missingSelectedRecipients
    && !savingDraft;
  const canSaveTemplate = Boolean(templateName.trim() && subject.trim() && body.trim()) && !savingTemplate;

  useEffect(() => {
    if (!selectedTemplateId) return;
    if (!templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId('');
    }
  }, [selectedTemplateId, templates]);

  const savedDraftsSection = (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Saved drafts</div>
          <div className="text-xs font-semibold leading-5 text-gray-500">Drafts keep selected recipients, subject, and body. Saving never sends email.</div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshDrafts} disabled={loadingDrafts}>
            {loadingDrafts ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </button>
          <button type="button" className="secondary-button !h-9 !min-h-9 text-xs" disabled={!canSaveDraft} onClick={onSaveDraft}>
            {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save draft
          </button>
        </div>
      </div>
      {loadingDrafts && drafts.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-500">Loading saved drafts...</div>
      ) : drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-500">
          No saved drafts yet.
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const isSelected = draft.id === selectedDraftId;
            return (
              <button
                key={draft.id}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left ${isSelected ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                onClick={() => onApplyDraft(draft.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{draft.subject || '(No subject)'}</div>
                    <div className="mt-0.5 text-xs font-semibold text-gray-500">{Math.max(draft.recipientIds.length, draft.recipients.length)} recipient{Math.max(draft.recipientIds.length, draft.recipients.length) === 1 ? '' : 's'} · {formatEmailSentTime(draft.updatedAt)}</div>
                  </div>
                  {isSelected ? <span className="text-[11px] font-black uppercase">Current</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!draftAudienceSupported ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
          Draft saving is available only for Selected members.
        </div>
      ) : missingSelectedRecipients ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
          Choose at least one selected member before saving or sending email.
        </div>
      ) : null}
    </div>
  );

  const reusableTemplatesSection = (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Reusable templates</div>
          <div className="text-xs font-semibold leading-5 text-gray-500">Apply a saved subject and body without changing recipients.</div>
        </div>
        <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshTemplates} disabled={loadingTemplates}>
          {loadingTemplates ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Refresh
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="app-label">Saved template</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          >
            <option value="">Select a template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button sm:mt-6" disabled={!selectedTemplateId} onClick={() => onApplyTemplate(selectedTemplateId)}>
          Apply template
        </button>
      </div>
      {!loadingTemplates && templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-500">
          No saved team email templates yet.
        </div>
      ) : null}
      <label className="block">
        <span className="app-label">Save current email as template</span>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            value={templateName}
            onChange={(event) => onTemplateNameChange(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Weekly reminder"
            maxLength={120}
            enterKeyHint="next"
          />
          <button type="button" className="secondary-button sm:min-w-[148px]" disabled={!canSaveTemplate} onClick={onSaveTemplate}>
            {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save template
          </button>
        </div>
      </label>
    </div>
  );

  return (
    <Sheet title="Team Email" onClose={onClose}>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
          Sends one backend roster email job. This is separate from chat posting, and delivery jobs are queued.
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
          Audience: {audienceSummary}
        </div>
        {recipientOptionsLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-500">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
            Loading recipient options...
          </div>
        ) : recipientOptionsError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
            <div>{recipientOptionsError}</div>
            <button type="button" className="ghost-button mt-2 !h-8 !min-h-8 !px-2 text-xs" onClick={onRetryRecipientOptions}>
              Retry recipient load
            </button>
          </div>
        ) : null}
        {isDesktopWeb ? savedDraftsSection : null}
        {isDesktopWeb ? reusableTemplatesSection : null}
        <label className="block">
          <span className="app-label">Subject</span>
          <input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Team update"
            maxLength={160}
            enterKeyHint="next"
          />
        </label>
        <label className="block">
          <span className="app-label">Message</span>
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            className="mt-1 min-h-36 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Write the email body..."
            maxLength={5000}
            enterKeyHint="send"
          />
        </label>
        <button type="submit" className="primary-button w-full" disabled={!canSendEmail}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
          Send email
        </button>
        {status ? <StatusBanner status={status} onClose={onStatusClose} /> : null}
        {!isDesktopWeb ? savedDraftsSection : null}
        {!isDesktopWeb ? reusableTemplatesSection : null}
      </form>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-gray-950">Sent email history</div>
            <div className="text-xs font-semibold text-gray-500">Latest queued roster emails. Recipient email addresses are hidden.</div>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshHistory} disabled={loadingHistory}>
            {loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </button>
        </div>
        {historyStatus ? <StatusBanner status={historyStatus} onClose={onHistoryStatusClose} /> : null}
        <div className="mt-3 space-y-2">
          {loadingHistory && sentEmails.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-500">Loading sent emails...</div>
          ) : sentEmails.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-500">No sent team emails yet.</div>
          ) : sentEmails.map((email) => {
            const delivery = email.delivery || {};
            const statusLabel = String(delivery.status || email.status || 'queued');
            return (
              <div key={email.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{email.subject || '(No subject)'}</div>
                    <div className="mt-0.5 text-xs font-semibold text-gray-500">From {email.senderName || 'Team admin'} · {formatEmailSentTime(email.sentAt)}</div>
                  </div>
                  <div className="flex-none text-right text-xs font-bold text-gray-500">
                    {Number(email.recipientCount || 0)} recipients<br />{statusLabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function formatEmailSentTime(value: unknown) {
  const day = formatChatDay(value);
  const time = formatChatTime(value);
  return [day, time].filter(Boolean).join(' ') || 'Queued';
}
