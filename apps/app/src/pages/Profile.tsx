import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clipboard,
  Copy,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  UserCircle,
  XCircle
} from 'lucide-react';
import { describeAuthError, reloadCurrentUser, resendVerificationEmail, sendResetEmail, setCurrentUserPassword } from '../lib/authService';
import {
  acquireProfilePhoto,
  createProfileAccessCode,
  loadParentTeams,
  loadNotificationPreferences,
  loadNotificationTeams,
  loadProfileAccessCodes,
  loadProfileDocument,
  normalizeNotificationPreferences,
  normalizeProfilePhoto,
  requestAccountMerge,
  saveNotificationPreferences,
  saveProfileDocument,
  uploadProfilePhoto
} from '../lib/profileService';
import {
  enablePushNotificationsForUser,
  getPushNotificationPermissionStatus,
  openPushNotificationSettings,
  type PushNotificationPermissionStatus
} from '../lib/pushService';
import { buildAppAcceptInviteUrl } from '../lib/inviteUrls';
import { sharePublicUrl } from '../lib/publicActions';
import { useShellLayout } from '../lib/useShellLayout';
import { NOTIFICATION_PREFERENCE_GROUPS } from '../../../../js/notification-preferences.js';
import type { AccessCodeRecord, NotificationCategory, NotificationPreferences, NotificationTeam, ProfileDocument } from '../lib/profileService';
import type { ProfilePhotoSource } from '../lib/profileService';
import type { AuthState } from '../lib/types';

type Tone = 'neutral' | 'success' | 'error';

type Status = {
  message: string;
  tone: Tone;
};

type ProfileSectionId = 'account' | 'alerts' | 'invites' | 'security';

const emptyPreferences = normalizeNotificationPreferences(null);
const gameDayDefaultPreferences: Partial<NotificationPreferences> = {
  liveScore: true,
  schedule: true,
  rsvp: true
};
const notificationPreferenceGroups = NOTIFICATION_PREFERENCE_GROUPS as readonly {
  id: string;
  label: string;
  categories: readonly { id: NotificationCategory; label: string }[];
}[];
const collapsedInviteCount = 3;
const profileSections: Array<{ id: ProfileSectionId; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'invites', label: 'Invites' },
  { id: 'security', label: 'Security' }
];

export function Profile({ auth }: { auth: AuthState }) {
  const navigate = useNavigate();
  const { isDesktopWeb, isNative } = useShellLayout();
  const user = auth.user;
  const [profile, setProfile] = useState<ProfileDocument>({});
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoChooserOpen, setPhotoChooserOpen] = useState(false);
  const [notificationTeams, setNotificationTeams] = useState<NotificationTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(emptyPreferences);
  const [accessCodes, setAccessCodes] = useState<AccessCodeRecord[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [parentLinkedTeams, setParentLinkedTeams] = useState<NotificationTeam[]>([]);
  const [accountMergeExpanded, setAccountMergeExpanded] = useState(false);
  const [accountMergeEmail, setAccountMergeEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [profileStatus, setProfileStatus] = useState<Status | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<Status | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<Status | null>(null);
  const [pushPermissionStatus, setPushPermissionStatus] = useState<PushNotificationPermissionStatus | null>(null);
  const [pushPermissionLoading, setPushPermissionLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status | null>(null);
  const [inviteStatus, setInviteStatus] = useState<Status | null>(null);
  const [accountMergeStatus, setAccountMergeStatus] = useState<Status | null>(null);
  const [inviteActionStatus, setInviteActionStatus] = useState('');
  const [inviteHistoryExpanded, setInviteHistoryExpanded] = useState(false);
  const [activeProfileSection, setActiveProfileSection] = useState<ProfileSectionId>('account');
  const [notificationTeamsLoaded, setNotificationTeamsLoaded] = useState(false);
  const [accessCodesLoaded, setAccessCodesLoaded] = useState(false);
  const [parentLinkedTeamsLoaded, setParentLinkedTeamsLoaded] = useState(false);
  const [loadedNotificationTeamId, setLoadedNotificationTeamId] = useState('');
  const [generatedInviteMetadata, setGeneratedInviteMetadata] = useState<{ email: string; phone: string }>({ email: '', phone: '' });
  const ownedPhotoPreviewUrlRef = useRef<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoSelectionIdRef = useRef(0);
  const photoFileRef = useRef<File | null>(null);
  const photoUrlRef = useRef('');
  const photoChangedRef = useRef(false);

  const revokeOwnedPhotoPreviewUrl = () => {
    const activePreviewUrl = ownedPhotoPreviewUrlRef.current;
    if (activePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(activePreviewUrl);
    }
    ownedPhotoPreviewUrlRef.current = null;
  };

  const displayName = fullName || user?.displayName || profile.displayName || user?.email || 'ALL PLAYS User';
  const showPasswordSection = profile.signInMethod === 'emailLink' && !profile.hasPassword;
  const updatedAt = useMemo(() => formatTimestamp(profile.updatedAt), [profile.updatedAt]);
  const signupLink = generatedCode ? buildSignupLink(generatedCode) : '';
  const visibleAccessCodes = inviteHistoryExpanded ? accessCodes : accessCodes.slice(0, collapsedInviteCount);
  const hiddenAccessCodeCount = Math.max(0, accessCodes.length - visibleAccessCodes.length);
  const canRequestAccountMerge = auth.isParent && (accountMergeExpanded || !parentLinkedTeamsLoaded || parentLinkedTeams.length > 0);
  const selectedNotificationTeam = notificationTeams.find((team) => team.id === selectedTeamId) || null;
  const alertsLoading = activeProfileSection === 'alerts' && !notificationTeamsLoaded;
  const alertsEmpty = activeProfileSection === 'alerts' && notificationTeamsLoaded && notificationTeams.length === 0;
  const alertsReady = activeProfileSection === 'alerts' && notificationTeamsLoaded && Boolean(selectedNotificationTeam);
  const selectedTeamPreferencesHydrated = Boolean(selectedTeamId) && loadedNotificationTeamId === selectedTeamId;
  const selectedTeamPreferencesLoading = alertsReady && Boolean(selectedTeamId) && !selectedTeamPreferencesHydrated;
  const nativePushEnabled = isNative && pushPermissionStatus?.state === 'enabled';
  const nativePushBlocked = isNative && pushPermissionStatus?.state === 'blocked';
  const nativePushUnsupported = isNative && pushPermissionStatus?.state === 'unsupported';

  const refreshPushPermissionStatus = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isNative || activeProfileSection !== 'alerts') {
      setPushPermissionStatus(null);
      setPushPermissionLoading(false);
      return null;
    }

    if (!options.silent) {
      setPushPermissionLoading(true);
    }

    try {
      const nextStatus = await getPushNotificationPermissionStatus();
      setPushPermissionStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      console.warn('[profile] Unable to load push permission state:', error);
      setPushPermissionStatus({
        state: 'unsupported',
        isNative: true,
        platform: 'native',
        canPrompt: false,
        canOpenSettings: false
      });
      return null;
    } finally {
      setPushPermissionLoading(false);
    }
  }, [activeProfileSection, isNative]);

  const selectProfileSection = (sectionId: ProfileSectionId) => {
    setActiveProfileSection(sectionId);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  useEffect(() => {
    return () => {
      revokeOwnedPhotoPreviewUrl();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!user) {
        return;
      }

      photoSelectionIdRef.current += 1;
      setLoading(true);
      setProfileStatus(null);
      setNotificationStatus(null);
      setInviteStatus(null);
      setAccountMergeStatus(null);
      setNotificationTeams([]);
      setNotificationTeamsLoaded(false);
      setPushPermissionStatus(null);
      setPushPermissionLoading(false);
      setNotificationPreferences(emptyPreferences);
      setLoadedNotificationTeamId('');
      setSelectedTeamId('');
      setAccessCodes([]);
      setInviteActionStatus('');
      setAccessCodesLoaded(false);
      setParentLinkedTeams([]);
      setParentLinkedTeamsLoaded(false);
      setAccountMergeExpanded(false);
      setAccountMergeEmail('');

      try {
        const loadedProfile = await loadProfileDocument(user.uid).catch((error) => {
          console.warn('[profile] Unable to load profile:', error);
          setProfileStatus({ message: 'Profile details could not be loaded yet.', tone: 'error' });
          return {} as ProfileDocument;
        });

        if (cancelled) {
          return;
        }

        revokeOwnedPhotoPreviewUrl();
        setProfile(loadedProfile);
        setFullName(loadedProfile.fullName || user.displayName || '');
        setPhone(loadedProfile.phone || '');
        photoUrlRef.current = loadedProfile.photoUrl || '';
        photoFileRef.current = null;
        photoChangedRef.current = false;
        setPhotoUrl(loadedProfile.photoUrl || '');
        setPhotoPreview(loadedProfile.photoUrl || '');
        setPhotoFile(null);
        setPhotoChanged(false);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    void refreshPushPermissionStatus();
  }, [refreshPushPermissionStatus]);

  useEffect(() => {
    if (!isNative || activeProfileSection !== 'alerts') {
      return;
    }

    const refreshOnReturn = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void refreshPushPermissionStatus({ silent: true });
    };

    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);

    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [activeProfileSection, isNative, refreshPushPermissionStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadAlertsData() {
      if (!user || activeProfileSection !== 'alerts' || notificationTeamsLoaded) {
        return;
      }

      try {
        const teams = await loadNotificationTeams(user.uid, user.email).catch((error) => {
          console.warn('[profile] Unable to load notification teams:', error);
          setNotificationStatus({ message: 'Unable to load teams for notifications.', tone: 'error' });
          return [];
        });

        if (cancelled) {
          return;
        }

        const initialTeamId = teams[0]?.id || '';

        setNotificationTeams(teams);
        setSelectedTeamId((current) => {
          if (current && teams.some((team) => team.id === current)) {
            return current;
          }
          return initialTeamId;
        });

        if (!initialTeamId) {
          setNotificationTeamsLoaded(true);
          return;
        }

        try {
          const firstPrefs = await loadNotificationPreferences(user.uid, initialTeamId);
          if (!cancelled) {
            setNotificationPreferences(firstPrefs);
            setLoadedNotificationTeamId(initialTeamId);
          }
        } catch {
          // Don't set loadedNotificationTeamId on error so loadPreferences effect can retry
          if (!cancelled) {
            setNotificationStatus({ message: 'Unable to load notification preferences.', tone: 'error' });
          }
        } finally {
          if (!cancelled) {
            setNotificationTeamsLoaded(true);
          }
        }
      } catch {
        // no-op: handled inline above
      }
    }

    loadAlertsData();
    return () => {
      cancelled = true;
    };
  }, [activeProfileSection, notificationTeamsLoaded, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      if (!user || activeProfileSection !== 'alerts' || !notificationTeamsLoaded) {
        return;
      }
      if (!selectedTeamId) {
        setNotificationPreferences(emptyPreferences);
        setLoadedNotificationTeamId('');
        return;
      }
      if (loadedNotificationTeamId === selectedTeamId) {
        return;
      }

      try {
        const preferences = await loadNotificationPreferences(user.uid, selectedTeamId);
        if (!cancelled) {
          setNotificationPreferences(preferences);
          setLoadedNotificationTeamId(selectedTeamId);
        }
      } catch (error) {
        console.warn('[profile] Unable to load notification preferences:', error);
        if (!cancelled) {
          setNotificationPreferences(emptyPreferences);
          setLoadedNotificationTeamId(selectedTeamId);
          setNotificationStatus({ message: 'Unable to load notification preferences.', tone: 'error' });
        }
      }
    }

    loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [activeProfileSection, loadedNotificationTeamId, notificationTeamsLoaded, selectedTeamId, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadInvitesData() {
      if (!user || activeProfileSection !== 'invites' || accessCodesLoaded) {
        return;
      }

      try {
        const codes = await loadProfileAccessCodes(user.uid).catch((error) => {
          console.warn('[profile] Unable to load access codes:', error);
          setInviteStatus({ message: 'Unable to load invite history.', tone: 'error' });
          return [];
        });

        if (!cancelled) {
          setAccessCodes(codes);
          setAccessCodesLoaded(true);
        }
      } catch {
        // no-op: handled inline above
      }
    }

    loadInvitesData();
    return () => {
      cancelled = true;
    };
  }, [accessCodesLoaded, activeProfileSection, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadParentLinkedTeams() {
      if (!user || !accountMergeExpanded || parentLinkedTeamsLoaded) {
        return;
      }

      try {
        const teams = await loadParentTeams(user.uid).catch((error) => {
          console.warn('[profile] Unable to load parent-linked teams:', error);
          setAccountMergeStatus({ message: 'Unable to load account merge options right now.', tone: 'error' });
          return [];
        });

        if (!cancelled) {
          setParentLinkedTeams(teams);
          setParentLinkedTeamsLoaded(true);
        }
      } catch {
        // no-op: handled inline above
      }
    }

    loadParentLinkedTeams();
    return () => {
      cancelled = true;
    };
  }, [accountMergeExpanded, parentLinkedTeamsLoaded, user]);

  const applySelectedPhoto = (file: File) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfileStatus({ message: 'Choose an image file.', tone: 'error' });
      return;
    }

    const nextPhotoPreviewUrl = URL.createObjectURL(file);
    revokeOwnedPhotoPreviewUrl();
    ownedPhotoPreviewUrlRef.current = nextPhotoPreviewUrl;
    photoFileRef.current = file;
    photoChangedRef.current = true;
    setPhotoFile(file);
    setPhotoPreview(nextPhotoPreviewUrl);
    setPhotoChanged(true);
    setProfileStatus(null);
  };

  const prepareSelectedPhoto = async (file: File, options: { normalize?: boolean } = {}) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfileStatus({ message: 'Choose an image file.', tone: 'error' });
      return;
    }

    const selectionId = photoSelectionIdRef.current + 1;
    photoSelectionIdRef.current = selectionId;

    try {
      const nextFile = options.normalize === false ? file : await normalizeProfilePhoto(file);
      if (photoSelectionIdRef.current !== selectionId) {
        return;
      }
      applySelectedPhoto(nextFile);
    } catch (error: any) {
      if (photoSelectionIdRef.current !== selectionId) {
        return;
      }
      setProfileStatus({ message: error?.message || 'Profile photo could not be prepared right now.', tone: 'error' });
    }
  };

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await prepareSelectedPhoto(file);
    }
    event.target.value = '';
  };

  const handleNativePhotoChoice = async (source: ProfilePhotoSource) => {
    setBusy('photo-acquire');
    setProfileStatus(null);

    try {
      const file = await acquireProfilePhoto(source);
      await prepareSelectedPhoto(file, { normalize: false });
      setPhotoChooserOpen(false);
    } catch (error: any) {
      if (error?.code === 'cancelled') {
        setPhotoChooserOpen(false);
        return;
      }
      if (error?.code === 'unavailable' && source === 'photos') {
        photoInputRef.current?.click();
        setPhotoChooserOpen(false);
        return;
      }
      const message = error?.code === 'permission-denied'
        ? source === 'camera'
          ? 'Camera permission was denied. Allow camera access to take a new profile photo.'
          : 'Photo permission was denied. Allow photo library access to choose a profile photo.'
        : error?.message || 'Profile photo could not be updated right now.';
      setProfileStatus({ message, tone: 'error' });
      setPhotoChooserOpen(false);
    } finally {
      setBusy('');
    }
  };

  const removePhoto = () => {
    photoSelectionIdRef.current += 1;
    revokeOwnedPhotoPreviewUrl();
    photoFileRef.current = null;
    photoUrlRef.current = '';
    photoChangedRef.current = true;
    setPhotoFile(null);
    setPhotoUrl('');
    setPhotoPreview('');
    setPhotoChanged(true);
    setProfileStatus(null);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    setBusy('profile');
    setProfileStatus(null);

    try {
      const trimmedFullName = fullName.trim();
      const trimmedPhone = phone.trim();
      const selectedPhotoFile = photoFileRef.current;
      const selectedPhotoChanged = photoChangedRef.current;
      let nextPhotoUrl = photoUrlRef.current || '';
      if (selectedPhotoChanged && selectedPhotoFile) {
        setProfileStatus({ message: 'Uploading photo...', tone: 'neutral' });
        nextPhotoUrl = await uploadProfilePhoto(selectedPhotoFile);
      }

      await saveProfileDocument(user.uid, {
        fullName: trimmedFullName,
        phone: trimmedPhone,
        email: user.email,
        photoUrl: nextPhotoUrl || null
      });

      const nextProfile: ProfileDocument = {
        ...profile,
        email: user.email || profile.email,
        fullName: trimmedFullName,
        displayName: trimmedFullName,
        phone: trimmedPhone,
        photoUrl: nextPhotoUrl || '',
        updatedAt: new Date()
      };
      revokeOwnedPhotoPreviewUrl();
      setProfile(nextProfile);
      photoUrlRef.current = nextProfile.photoUrl || nextPhotoUrl || '';
      photoFileRef.current = null;
      photoChangedRef.current = false;
      setPhotoUrl(nextProfile.photoUrl || nextPhotoUrl || '');
      setPhotoPreview(nextProfile.photoUrl || nextPhotoUrl || '');
      setPhotoFile(null);
      setPhotoChanged(false);
      setProfileStatus({ message: 'Profile saved.', tone: 'success' });
      void auth.refresh().catch((error) => {
        console.warn('[profile] Unable to refresh auth after profile save:', error);
      });
    } catch (error: any) {
      setProfileStatus({ message: formatProfileSaveError(error), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const resendVerification = async () => {
    setBusy('verification');
    setVerificationStatus(null);

    try {
      await resendVerificationEmail();
      setVerificationStatus({ message: 'Verification email sent. Check your inbox.', tone: 'success' });
    } catch (error) {
      setVerificationStatus({ message: describeAuthError(error), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const refreshVerification = async () => {
    setBusy('refresh-verification');
    setVerificationStatus(null);

    try {
      await reloadCurrentUser();
      await auth.refresh();
      setVerificationStatus({ message: 'Verification status refreshed.', tone: 'success' });
    } catch (error) {
      setVerificationStatus({ message: describeAuthError(error), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const saveNotifications = async () => {
    if (!user || !selectedTeamId) {
      setNotificationStatus({ message: 'Select a team first.', tone: 'error' });
      return;
    }
    if (!selectedTeamPreferencesHydrated) {
      setNotificationStatus({ message: 'Wait for this team’s alert preferences to finish loading.', tone: 'error' });
      return;
    }

    setBusy('notifications');
    setNotificationStatus(null);

    try {
      const saved = await saveNotificationPreferences(user.uid, selectedTeamId, notificationPreferences);
      setNotificationPreferences(saved);
      setNotificationStatus({ message: 'Notification preferences saved.', tone: 'success' });
    } catch (error: any) {
      setNotificationStatus({ message: error?.message || 'Failed to save notification preferences.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const enablePushOnDevice = async () => {
    if (!user) {
      setNotificationStatus({ message: 'Sign in before enabling push notifications.', tone: 'error' });
      return;
    }

    setBusy('push-device');
    setNotificationStatus(null);

    try {
      await enablePushNotificationsForUser(user.uid);
      await refreshPushPermissionStatus({ silent: true });
      setNotificationStatus({ message: 'Push is enabled on this device.', tone: 'success' });
    } catch (error: any) {
      await refreshPushPermissionStatus({ silent: true });
      setNotificationStatus({ message: error?.message || 'Failed to enable push on this device.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const openDeviceSettingsForPush = async (statusMessage = 'Open device settings, allow notifications, then return here. We will refresh this screen when you come back.') => {
    setNotificationStatus({ message: statusMessage, tone: 'neutral' });
    await openPushNotificationSettings();
  };

  const turnOnGameDayAlerts = async () => {
    if (!user || !selectedTeamId) {
      setNotificationStatus({ message: 'Select a team first.', tone: 'error' });
      return;
    }

    const teamId = selectedTeamId;

    setBusy('game-day-alerts');
    setNotificationStatus(null);

    try {
      const currentPermissionStatus = isNative
        ? (pushPermissionStatus || await getPushNotificationPermissionStatus())
        : null;

      if (currentPermissionStatus) {
        setPushPermissionStatus(currentPermissionStatus);
      }

      if (currentPermissionStatus?.state === 'blocked') {
        await openDeviceSettingsForPush('Notifications are turned off in device settings. Open device settings to finish turning on game-day alerts.');
        return;
      }

      if (currentPermissionStatus?.state === 'unsupported') {
        setNotificationStatus({ message: 'Push notifications are not supported on this device.', tone: 'error' });
        return;
      }

      const currentPreferences = loadedNotificationTeamId === teamId
        ? notificationPreferences
        : await loadNotificationPreferences(user.uid, teamId);
      const nextPreferences = normalizeNotificationPreferences({
        ...currentPreferences,
        ...gameDayDefaultPreferences
      });

      await enablePushNotificationsForUser(user.uid);
      await refreshPushPermissionStatus({ silent: true });
      const saved = await saveNotificationPreferences(user.uid, teamId, nextPreferences);
      setNotificationPreferences(saved);
      setLoadedNotificationTeamId(teamId);
      setNotificationStatus({ message: 'Game-day alerts are on for this team.', tone: 'success' });
    } catch (error: any) {
      await refreshPushPermissionStatus({ silent: true });
      setNotificationStatus({ message: error?.message || 'Failed to turn on game-day alerts.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const sendPasswordReset = async () => {
    if (!user?.email) {
      setPasswordStatus({ message: 'No account email is loaded.', tone: 'error' });
      return;
    }

    setBusy('password-reset');
    setPasswordStatus(null);

    try {
      await sendResetEmail(user.email);
      setPasswordStatus({ message: 'Password reset email sent.', tone: 'success' });
    } catch (error) {
      setPasswordStatus({ message: describeAuthError(error), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const setPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordStatus(null);

    if (newPassword.length < 6) {
      setPasswordStatus({ message: 'Password must be at least 6 characters.', tone: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordStatus({ message: 'Passwords do not match.', tone: 'error' });
      return;
    }

    setBusy('password');

    try {
      await setCurrentUserPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setProfile((current) => ({ ...current, hasPassword: true }));
      setPasswordStatus({ message: 'Password set successfully.', tone: 'success' });
      await auth.refresh();
    } catch (error) {
      setPasswordStatus({ message: describeAuthError(error), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const createInviteCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    setBusy('invite');
    setInviteStatus(null);
    setInviteActionStatus('');

    try {
      const nextInviteEmail = inviteEmail.trim();
      const nextInvitePhone = invitePhone.trim();
      const code = await createProfileAccessCode(user.uid, nextInviteEmail, nextInvitePhone);
      setGeneratedCode(code);
      setGeneratedInviteMetadata({ email: nextInviteEmail, phone: nextInvitePhone });
      setInviteEmail('');
      setInvitePhone('');
      setAccessCodes(await loadProfileAccessCodes(user.uid));
      setAccessCodesLoaded(true);
      setInviteHistoryExpanded(true);
      setInviteStatus({ message: 'Invite code generated.', tone: 'success' });
    } catch (error: any) {
      setInviteStatus({ message: error?.message || 'Failed to generate invite code.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const submitAccountMerge = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.uid) {
      return;
    }

    const secondaryEmail = normalizeEmail(accountMergeEmail);
    const primaryEmail = normalizeEmail(user.email);

    if (!secondaryEmail) {
      setAccountMergeStatus({ message: 'Enter the email address for the other account.', tone: 'error' });
      return;
    }
    if (!isValidEmail(secondaryEmail)) {
      setAccountMergeStatus({ message: 'Enter a valid email address.', tone: 'error' });
      return;
    }
    if (secondaryEmail === primaryEmail) {
      setAccountMergeStatus({ message: 'Enter a different email than the account you are signed in with.', tone: 'error' });
      return;
    }

    setBusy('account-merge');
    setAccountMergeStatus({ message: 'Preparing merge request...', tone: 'neutral' });

    try {
      await requestAccountMerge(user.uid, primaryEmail, secondaryEmail);
      setAccountMergeEmail('');
      setAccountMergeStatus({ message: 'Merge request pending verification. We will verify the other email before moving any account data.', tone: 'success' });
    } catch (error) {
      console.error('[profile] Unable to request account merge:', error);
      setAccountMergeStatus({ message: 'Unable to request merge right now. Please try again.', tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setInviteActionStatus(label);
      window.setTimeout(() => setInviteActionStatus(''), 1800);
    } catch {
      setInviteActionStatus('Copy failed');
      window.setTimeout(() => setInviteActionStatus(''), 1800);
    }
  };

  const shareInviteLink = async (code: string, metadata?: { email?: string | null; phone?: string | null; type?: string | null }) => {
    const result = await sharePublicUrl(buildInviteShareInput(code, metadata));
    if (result === 'shared') {
      setInviteActionStatus('Share sheet opened.');
      return;
    }
    if (result === 'copied') {
      setInviteActionStatus('Link copied.');
      return;
    }
    if (result === 'cancelled') {
      setInviteActionStatus('Share cancelled.');
      return;
    }
    setInviteActionStatus('Unable to share invite link.');
  };

  const handleSignOut = async () => {
    setBusy('logout');
    try {
      await auth.signOut();
      navigate('/auth', { replace: true });
    } finally {
      setBusy('');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className={isDesktopWeb ? 'profile-page profile-page-web' : 'space-y-4'}>
      <section className="app-card profile-summary-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-primary-700">
            {photoPreview ? <img src={photoPreview} alt="" className="h-full w-full object-cover" /> : <UserCircle className="h-9 w-9" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label">Profile</div>
            <h1 className="truncate text-2xl font-black text-gray-950">{displayName}</h1>
            <p className="truncate text-sm font-semibold text-gray-600">{user.email || 'No email loaded'}</p>
            <p className="mt-1 text-xs font-bold text-gray-400">Last updated: {updatedAt}</p>
          </div>
          <button type="button" className="ghost-button flex-none !px-3" onClick={handleSignOut} disabled={busy === 'logout'} aria-label="Sign out">
            {busy === 'logout' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </section>

      <div className="profile-section-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-4 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
          {profileSections.map((section) => {
            const active = activeProfileSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`min-h-10 rounded-xl px-3 text-sm font-black transition ${active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
                onClick={() => selectProfileSection(section.id)}
                aria-pressed={active}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeProfileSection === 'account' ? (
      <section className="app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="app-label">Account profile</div>
            <h2 className="mt-1 app-section-title">Your Account</h2>
          </div>
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>

        <form className="mt-4 space-y-4" onSubmit={saveProfile}>
          <div className="flex flex-wrap items-center gap-3">
            {isNative ? (
              <>
                <button type="button" className="secondary-button" onClick={() => setPhotoChooserOpen(true)} disabled={busy === 'photo-acquire'}>
                  {busy === 'photo-acquire' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  Choose photo
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} tabIndex={-1} aria-hidden="true" />
              </>
            ) : (
              <label className="secondary-button cursor-pointer">
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                Choose photo
                <input ref={photoInputRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
              </label>
            )}
            {photoPreview ? (
              <button type="button" className="ghost-button" onClick={removePhoto}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </button>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Email</span>
            <input className="auth-input bg-gray-100 text-gray-600" value={user.email || ''} disabled />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Full name</span>
              <input className="auth-input" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Phone</span>
              <input className="auth-input" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="123-456-7890" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="primary-button" disabled={busy === 'profile'}>
              {busy === 'profile' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save profile
            </button>
            <StatusMessage status={profileStatus} />
          </div>
        </form>

        {canRequestAccountMerge ? (
          <div className="mt-6 border-t border-gray-200 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-gray-900">Merge another account</h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Request a merge for another ALL PLAYS account you own. We will verify that email before any account data moves.</p>
              </div>
              {!accountMergeExpanded ? (
                <button
                  type="button"
                  className="secondary-button shrink-0"
                  onClick={() => {
                    setAccountMergeExpanded(true);
                    setAccountMergeStatus(null);
                  }}
                >
                  Merge another account
                </button>
              ) : null}
            </div>

            {accountMergeExpanded ? (
              parentLinkedTeamsLoaded && parentLinkedTeams.length === 0 ? (
                <StatusMessage status={accountMergeStatus || { message: 'No parent-linked teams are available for account merge.', tone: 'neutral' }} className="mt-4 block" />
              ) : (
                <form className="mt-4 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4" onSubmit={submitAccountMerge} noValidate>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Secondary account email</span>
                    <input
                      className="auth-input"
                      type="email"
                      aria-label="Secondary account email"
                      value={accountMergeEmail}
                      onChange={(event) => setAccountMergeEmail(event.target.value)}
                      placeholder="other-email@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="submit" className="primary-button" disabled={busy === 'account-merge' || !parentLinkedTeamsLoaded}>
                      {busy === 'account-merge' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
                      Request merge
                    </button>
                    {!parentLinkedTeamsLoaded ? <StatusMessage status={{ message: 'Loading merge options...', tone: 'neutral' }} /> : <StatusMessage status={accountMergeStatus} />}
                  </div>
                </form>
              )
            ) : null}
          </div>
        ) : null}
      </section>
      ) : null}

      {activeProfileSection === 'alerts' ? (
      <section className="app-card p-4">
        <div className="flex items-center gap-2 text-sm font-black text-primary-800">
          <Bell className="h-4 w-4" aria-hidden="true" />
          Notification preferences
        </div>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">Per-team alerts for live chat, score updates, and schedule changes.</p>

        {alertsLoading ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-black text-gray-900">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading your alert teams…
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">We are checking which teams can receive alerts on this device.</p>
          </div>
        ) : null}

        {alertsEmpty ? (
          <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="text-sm font-black text-gray-900">No team alerts available yet</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">Join or create a team first, then come back here to turn on game-day and team update alerts.</p>
            <Link to="/teams" className="secondary-button mt-3 inline-flex">
              Go to My Teams
            </Link>
          </div>
        ) : null}

        {alertsReady ? (
          <>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Team</span>
                <select className="auth-input" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  <option value="">Select a team</option>
                  {notificationTeams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name || team.id}</option>
                  ))}
                </select>
              </label>
              {isNative ? <NativePushPermissionCard permissionStatus={pushPermissionStatus} loading={pushPermissionLoading} onOpenSettings={openDeviceSettingsForPush} onRefresh={() => void refreshPushPermissionStatus()} /> : null}
              <div className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="text-sm font-black text-gray-900">Device push</div>
                <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">
                  {nativePushEnabled
                    ? 'Notifications are already allowed on this device. Refresh registration if this device recently changed accounts.'
                    : nativePushBlocked
                      ? 'Notifications are turned off in device settings. Open settings to re-enable them for ALL PLAYS.'
                      : nativePushUnsupported
                        ? 'This device does not support push notifications in the native shell.'
                        : 'Register this device for push notifications without changing team alert preferences.'}
                </p>
                {nativePushUnsupported ? null : nativePushBlocked ? (
                  <button type="button" className="secondary-button mt-3" onClick={() => void openDeviceSettingsForPush()}>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Open device settings
                  </button>
                ) : (
                  <button type="button" className="secondary-button mt-3" onClick={enablePushOnDevice} disabled={busy === 'push-device' || !user}>
                    {busy === 'push-device' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                    {nativePushEnabled ? 'Refresh push registration' : 'Enable push on this device'}
                  </button>
                )}
              </div>
              <div className="rounded-2xl border border-primary-100 bg-primary-50 p-3">
                <div className="text-sm font-black text-primary-900">Game-day alerts</div>
                <p className="mt-1 text-sm font-semibold leading-6 text-primary-800">
                  {nativePushBlocked
                    ? 'Notifications are blocked in device settings. Open settings, allow notifications, then return here to finish game-day alerts.'
                    : 'One tap enables push on this device and turns on schedule changes and live score updates for the selected team.'}
                </p>
                <button type="button" className="primary-button mt-3" onClick={nativePushBlocked ? () => void openDeviceSettingsForPush('Notifications are turned off in device settings. Open device settings to finish turning on game-day alerts.') : turnOnGameDayAlerts} disabled={busy === 'game-day-alerts' || (!nativePushBlocked && (!selectedTeamId || !selectedTeamPreferencesHydrated))}>
                  {busy === 'game-day-alerts' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {nativePushBlocked ? 'Open device settings to finish alerts' : 'Turn on game-day alerts'}
                </button>
              </div>
            </div>

            <details className="mt-3 rounded-2xl border border-gray-200 bg-white p-3" open>
              <summary className="cursor-pointer text-sm font-black text-gray-700">Customize alerts</summary>
              {selectedTeamPreferencesLoading ? (
                <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3" role="status" aria-live="polite">
                  <div className="flex items-center gap-2 text-sm font-black text-gray-900">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading alerts for {selectedNotificationTeam?.name || 'this team'}…
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">Team-specific alert toggles will unlock as soon as the selected team’s saved preferences finish loading.</p>
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {notificationPreferenceGroups.map((group) => (
                    <div key={group.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                      <div className="text-xs font-black uppercase tracking-wide text-gray-500">{group.label}</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.categories.map((category) => (
                          <PreferenceToggle
                            key={category.id}
                            label={category.label}
                            checked={notificationPreferences[category.id]}
                            onChange={(checked) => setNotificationPreferences((current) => ({
                              ...current,
                              [category.id]: checked
                            }))}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="primary-button" onClick={saveNotifications} disabled={busy === 'notifications' || !selectedTeamId || !selectedTeamPreferencesHydrated}>
                  {busy === 'notifications' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  Save preferences
                </button>
              </div>
            </details>
          </>
        ) : null}

        <StatusMessage status={notificationStatus} className="mt-3 block" />
      </section>
      ) : null}

      {activeProfileSection === 'security' ? (
      <section className="app-card p-4">
        <div className="flex items-center gap-2 text-sm font-black text-primary-800">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Account settings
        </div>
        <div className={`mt-3 rounded-xl border p-3 ${user.emailVerified ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center gap-2 text-sm font-black">
            {user.emailVerified ? <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" /> : <XCircle className="h-5 w-5 text-amber-700" aria-hidden="true" />}
            <span className={user.emailVerified ? 'text-emerald-800' : 'text-amber-800'}>{user.emailVerified ? 'Email verified' : 'Email not verified'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!user.emailVerified ? (
              <button type="button" className="secondary-button" onClick={resendVerification} disabled={busy === 'verification'}>
                {busy === 'verification' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                Resend email
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={refreshVerification} disabled={busy === 'refresh-verification'}>
              {busy === 'refresh-verification' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              Refresh
            </button>
          </div>
          <StatusMessage status={verificationStatus} className="mt-3" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {auth.roles.map((role) => (
            <span key={role} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 text-sm font-black text-primary-700">
              {role}
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </span>
          ))}
        </div>

        {showPasswordSection ? (
          <form className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3" onSubmit={setPassword}>
            <div className="flex items-center gap-2 text-sm font-black text-amber-900">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Set a password
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="auth-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} placeholder="New password" />
              <input className="auth-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} placeholder="Confirm password" />
            </div>
            <button type="submit" className="secondary-button mt-3" disabled={busy === 'password'}>
              {busy === 'password' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              Set password
            </button>
          </form>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="secondary-button" onClick={sendPasswordReset} disabled={busy === 'password-reset'}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Send password reset
          </button>
          <button type="button" className="secondary-button" onClick={auth.refresh}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh account
          </button>
          <Link to="/verify-pending" className="ghost-button">
            <Mail className="h-4 w-4" aria-hidden="true" />
            Verification page
          </Link>
          <button type="button" className="ghost-button" onClick={handleSignOut} disabled={busy === 'logout'}>
            {busy === 'logout' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
            Sign out
          </button>
        </div>
        <StatusMessage status={passwordStatus} className="mt-3" />
      </section>
      ) : null}

      {activeProfileSection === 'invites' ? (
      <section className="app-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-primary-800">
              <Clipboard className="h-4 w-4" aria-hidden="true" />
              Invite codes
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">Create one-time access codes and keep recent history handy.</p>
          </div>
          {accessCodes.length ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-black text-gray-600">{accessCodes.length} total</span>
          ) : null}
        </div>

        <form className="mt-4 space-y-3" onSubmit={createInviteCode}>
          <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-gray-700">Advanced: add recipient label</summary>
            <p className="mt-2 text-xs font-semibold leading-5 text-gray-500">Optional only. Use these fields to annotate invite history; the app does not send the invite.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="auth-input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="coach@example.com" aria-label="Invite email label" />
              <input className="auth-input" type="tel" value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="(555) 123-4567" aria-label="Invite phone label" />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="primary-button" disabled={busy === 'invite'}>
              {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              Generate invite link
            </button>
            <StatusMessage status={inviteStatus} />
          </div>
        </form>

        {generatedCode ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-emerald-700">Generated invite link</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="primary-button" onClick={() => shareInviteLink(generatedCode, generatedInviteMetadata)}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share invite link
              </button>
              <button type="button" className="ghost-button" onClick={() => copyText(signupLink, 'Link copied.')}>
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Copy invite link
              </button>
              <span className="break-all rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-700">{signupLink}</span>
            </div>
            {inviteActionStatus ? <div className="mt-2 text-sm font-black text-emerald-700">{inviteActionStatus}</div> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-gray-600">
              <span>Fallback code</span>
              <code className="rounded-lg bg-white px-3 py-1.5 text-lg font-black tracking-widest text-gray-950">{generatedCode}</code>
              <button type="button" className="ghost-button" onClick={() => copyText(generatedCode, 'Code copied.')}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy code
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {accessCodes.length ? visibleAccessCodes.map((code) => (
            <AccessCodeCard key={code.id} code={code} onCopy={copyText} onShare={shareInviteLink} />
          )) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No codes generated yet.</div>
          )}
        </div>

        {!generatedCode && inviteActionStatus ? <div className="mt-3 text-sm font-black text-emerald-700">{inviteActionStatus}</div> : null}

        {accessCodes.length > collapsedInviteCount ? (
          <button type="button" className="ghost-button mt-3 w-full justify-center" onClick={() => setInviteHistoryExpanded((current) => !current)}>
            {inviteHistoryExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            {inviteHistoryExpanded ? 'Show fewer codes' : `Show ${hiddenAccessCodeCount} more`}
          </button>
        ) : null}
      </section>
      ) : null}

      {photoChooserOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="profile-photo-chooser-title">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setPhotoChooserOpen(false)} aria-label="Close photo options" />
          <section className="relative w-full rounded-t-3xl bg-white p-4 shadow-2xl sm:max-w-sm sm:rounded-2xl">
            <div className="app-label">Profile photo</div>
            <h2 id="profile-photo-chooser-title" className="mt-1 text-lg font-black text-gray-950">Choose how to update your photo</h2>
            <div className="mt-4 space-y-2">
              <button type="button" className="primary-button w-full justify-center" onClick={() => handleNativePhotoChoice('camera')} disabled={busy === 'photo-acquire'}>
                Take photo
              </button>
              <button type="button" className="secondary-button w-full justify-center" onClick={() => handleNativePhotoChoice('photos')} disabled={busy === 'photo-acquire'}>
                Choose existing photo
              </button>
              <button type="button" className="ghost-button w-full justify-center" onClick={() => setPhotoChooserOpen(false)} disabled={busy === 'photo-acquire'}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PreferenceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-14 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3">
      <input className="h-5 w-5 accent-primary-600" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="text-sm font-black text-gray-700">{label}</span>
    </label>
  );
}

function NativePushPermissionCard({
  permissionStatus,
  loading,
  onOpenSettings,
  onRefresh
}: {
  permissionStatus: PushNotificationPermissionStatus | null;
  loading: boolean;
  onOpenSettings: (statusMessage?: string) => Promise<void>;
  onRefresh: () => void;
}) {
  if (loading && !permissionStatus) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm font-black text-gray-900">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking device notification access…
        </div>
      </div>
    );
  }

  if (!permissionStatus) {
    return null;
  }

  if (permissionStatus.state === 'enabled') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-sm font-black text-emerald-900">Push is allowed on this device</div>
        <p className="mt-1 text-sm font-semibold leading-6 text-emerald-800">ALL PLAYS can request push registration here without sending you back through the OS permission prompt.</p>
      </div>
    );
  }

  if (permissionStatus.state === 'blocked') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-sm font-black text-amber-900">Notifications are off in device settings</div>
        <p className="mt-1 text-sm font-semibold leading-6 text-amber-800">ALL PLAYS cannot enable push until notifications are turned back on at the OS level. Open device settings, allow notifications, then return here. This screen refreshes when you come back.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="secondary-button" onClick={() => void onOpenSettings()}>
            Open device settings
          </button>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (permissionStatus.state === 'unsupported') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
        <div className="text-sm font-black text-gray-900">Push is unavailable on this device</div>
        <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">This native shell cannot register for push notifications right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary-100 bg-primary-50 p-3">
      <div className="text-sm font-black text-primary-900">Allow notifications to finish setup</div>
      <p className="mt-1 text-sm font-semibold leading-6 text-primary-800">The next step will show the iPhone or Android notification prompt. After you allow notifications, ALL PLAYS can finish device registration here.</p>
    </div>
  );
}

function AccessCodeCard({ code, onCopy, onShare }: { code: AccessCodeRecord; onCopy: (text: string, label: string) => void; onShare: (code: string, metadata?: { email?: string | null; phone?: string | null; type?: string | null }) => void }) {
  const signupLink = buildSignupLink(code.code, code.type);
  return (
    <div className={`rounded-xl border p-3 ${code.used ? 'border-gray-200 bg-gray-50' : 'border-primary-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-primary-50 px-3 py-1.5 text-lg font-black tracking-widest text-primary-900">{code.code}</code>
          <span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase tracking-[0.04em] ${code.used ? 'bg-gray-200 text-gray-700' : 'bg-emerald-100 text-emerald-700'}`}>{code.used ? 'Used' : 'Active'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ghost-button !min-h-9 !px-3 !py-1.5" onClick={() => onCopy(code.code, 'Code copied.')} aria-label={`Copy saved invite code ${code.code}`}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-black">Copy code</span>
          </button>
          {!code.used ? (
            <button type="button" className="ghost-button !min-h-9 !px-3 !py-1.5" onClick={() => onShare(code.code, { email: code.email, phone: code.phone, type: code.type })} aria-label={`Share saved invite link for ${code.code}`}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-black">Share link</span>
            </button>
          ) : null}
          {!code.used ? (
            <button type="button" className="ghost-button !min-h-9 !px-3 !py-1.5" onClick={() => onCopy(signupLink, 'Link copied.')} aria-label={`Copy saved invite link for ${code.code}`}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-black">Copy link</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs font-semibold text-gray-500">
        {code.email ? <div className="break-all">{code.email}</div> : null}
        {code.phone ? <div>{code.phone}</div> : null}
        <div>Created {formatTimestamp(code.createdAt, 'date')}</div>
        {code.used && code.usedAt ? <div className="text-emerald-700">Used {formatTimestamp(code.usedAt, 'date')}</div> : null}
      </div>
    </div>
  );
}

function StatusMessage({ status, className = '' }: { status: Status | null; className?: string }) {
  if (!status?.message) {
    return null;
  }

  const toneClass = status.tone === 'success' ? 'text-emerald-700' : status.tone === 'error' ? 'text-rose-700' : 'text-gray-600';
  return <span className={`text-sm font-bold ${toneClass} ${className}`}>{status.message}</span>;
}

function formatTimestamp(value: unknown, mode: 'date' | 'datetime' = 'datetime') {
  const date = toDate(value);
  if (!date) {
    return '—';
  }

  if (mode === 'date') {
    return date.toLocaleDateString();
  }

  return date.toLocaleString();
}

function toDate(value: any): Date | null {
  if (!value) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function buildSignupLink(code: string, inviteType?: string | null) {
  return buildAppAcceptInviteUrl(code, inviteType);
}

function buildInviteShareInput(code: string, metadata?: { email?: string | null; phone?: string | null; type?: string | null }) {
  const recipientDetails = [metadata?.email, metadata?.phone].map((value) => String(value || '').trim()).filter(Boolean);
  const recipientLabel = recipientDetails.join(' • ');
  const signupLink = buildSignupLink(code, metadata?.type);
  return {
    title: recipientLabel ? `ALL PLAYS invite for ${recipientLabel}` : 'ALL PLAYS invite link',
    text: recipientLabel ? `Use this ALL PLAYS invite link for ${recipientLabel}.` : 'Use this ALL PLAYS invite link to join ALL PLAYS.',
    url: signupLink,
    clipboardText: signupLink
  };
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatProfileSaveError(error: any) {
  const message = String(error?.message || 'Profile save failed.');
  if (/requests-from-referer/i.test(message)) {
    return 'Image uploads are allowlisted for the app and local dev on localhost:8000 or localhost:8100. Refresh the app and try again.';
  }
  if (/permission|unauthori[sz]ed/i.test(message)) {
    return 'Upload reached Firebase, but this account does not have permission to save the image.';
  }
  if (/cors/i.test(message)) {
    return 'Image upload was blocked by browser upload settings. Refresh the app and try again.';
  }
  return message;
}
