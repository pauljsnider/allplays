import { useCallback, useState } from 'react';

type ChatSheetsState = {
    showConversationSheet: boolean;
    showAudienceSheet: boolean;
    showMediaGallery: boolean;
    showAttachSheet: boolean;
    showLinkSheet: boolean;
    showEmailSheet: boolean;
};

const initialState: ChatSheetsState = {
    showConversationSheet: false,
    showAudienceSheet: false,
    showMediaGallery: false,
    showAttachSheet: false,
    showLinkSheet: false,
    showEmailSheet: false
};

export function useChatSheets() {
    const [sheets, setSheets] = useState<ChatSheetsState>(initialState);

    const openConversationSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showConversationSheet: true }));
    }, []);

    const closeConversationSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showConversationSheet: false }));
    }, []);

    const openAudienceSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAudienceSheet: true }));
    }, []);

    const closeAudienceSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAudienceSheet: false }));
    }, []);

    const openMediaGallery = useCallback(() => {
        setSheets((current) => ({ ...current, showMediaGallery: true }));
    }, []);

    const closeMediaGallery = useCallback(() => {
        setSheets((current) => ({ ...current, showMediaGallery: false }));
    }, []);

    const openAttachSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAttachSheet: true }));
    }, []);

    const closeAttachSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAttachSheet: false }));
    }, []);

    const openLinkSheet = useCallback(() => {
        setSheets((current) => ({
            ...current,
            showAttachSheet: false,
            showLinkSheet: true
        }));
    }, []);

    const closeLinkSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showLinkSheet: false }));
    }, []);

    const openEmailSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showEmailSheet: true }));
    }, []);

    const closeEmailSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showEmailSheet: false }));
    }, []);

    return {
        ...sheets,
        openConversationSheet,
        closeConversationSheet,
        openAudienceSheet,
        closeAudienceSheet,
        openMediaGallery,
        closeMediaGallery,
        openAttachSheet,
        closeAttachSheet,
        openLinkSheet,
        closeLinkSheet,
        openEmailSheet,
        closeEmailSheet
    };
}
