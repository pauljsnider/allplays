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

function activateSheet(sheetName: keyof ChatSheetsState): ChatSheetsState {
    return {
        ...initialState,
        [sheetName]: true
    };
}

export function useChatSheets() {
    const [sheets, setSheets] = useState<ChatSheetsState>(initialState);

    const openConversationSheet = useCallback(() => {
        setSheets(activateSheet('showConversationSheet'));
    }, []);

    const closeConversationSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showConversationSheet: false }));
    }, []);

    const openAudienceSheet = useCallback(() => {
        setSheets(activateSheet('showAudienceSheet'));
    }, []);

    const closeAudienceSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAudienceSheet: false }));
    }, []);

    const openMediaGallery = useCallback(() => {
        setSheets(activateSheet('showMediaGallery'));
    }, []);

    const closeMediaGallery = useCallback(() => {
        setSheets((current) => ({ ...current, showMediaGallery: false }));
    }, []);

    const openAttachSheet = useCallback(() => {
        setSheets(activateSheet('showAttachSheet'));
    }, []);

    const closeAttachSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showAttachSheet: false }));
    }, []);

    const openLinkSheet = useCallback(() => {
        setSheets({
            ...initialState,
            showLinkSheet: true
        });
    }, []);

    const closeLinkSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showLinkSheet: false }));
    }, []);

    const openEmailSheet = useCallback(() => {
        setSheets(activateSheet('showEmailSheet'));
    }, []);

    const closeEmailSheet = useCallback(() => {
        setSheets((current) => ({ ...current, showEmailSheet: false }));
    }, []);

    const resetSheets = useCallback(() => {
        setSheets(initialState);
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
        closeEmailSheet,
        resetSheets
    };
}
