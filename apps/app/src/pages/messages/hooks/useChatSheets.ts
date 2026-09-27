import { useCallback, useState } from 'react';

type ChatSheetsState = {
    showConversationSheet: boolean;
    showAudienceSheet: boolean;
    showMediaGallery: boolean;
    showAttachSheet: boolean;
    showLinkSheet: boolean;
    showEmailSheet: boolean;
    audienceReturnSheet: 'email' | null;
};

type ChatSheetName = Exclude<keyof ChatSheetsState, 'audienceReturnSheet'>;

const initialState: ChatSheetsState = {
    showConversationSheet: false,
    showAudienceSheet: false,
    showMediaGallery: false,
    showAttachSheet: false,
    showLinkSheet: false,
    showEmailSheet: false,
    audienceReturnSheet: null
};

function activateSheet(sheetName: ChatSheetName, audienceReturnSheet: ChatSheetsState['audienceReturnSheet'] = null): ChatSheetsState {
    return {
        ...initialState,
        [sheetName]: true,
        audienceReturnSheet
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

    const openEmailAudienceSheet = useCallback(() => {
        setSheets(activateSheet('showAudienceSheet', 'email'));
    }, []);

    const closeAudienceSheet = useCallback(() => {
        setSheets((current) => current.audienceReturnSheet === 'email'
            ? activateSheet('showEmailSheet')
            : { ...current, showAudienceSheet: false, audienceReturnSheet: null });
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

    return {
        ...sheets,
        openConversationSheet,
        closeConversationSheet,
        openAudienceSheet,
        openEmailAudienceSheet,
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
