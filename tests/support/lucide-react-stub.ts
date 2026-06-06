import React from 'react';

function createIcon(name: string) {
  return function LucideIcon(props: Record<string, unknown>) {
    return React.createElement('svg', { ...props, 'data-icon': name });
  };
}

export const AlertCircle = createIcon('AlertCircle');
export const Bell = createIcon('Bell');
export const ChevronDown = createIcon('ChevronDown');
export const ChevronLeft = createIcon('ChevronLeft');
export const ChevronUp = createIcon('ChevronUp');
export const CheckCircle2 = createIcon('CheckCircle2');
export const Clipboard = createIcon('Clipboard');
export const Copy = createIcon('Copy');
export const ImagePlus = createIcon('ImagePlus');
export const KeyRound = createIcon('KeyRound');
export const Link2 = createIcon('Link2');
export const Loader2 = createIcon('Loader2');
export const LogOut = createIcon('LogOut');
export const Mail = createIcon('Mail');
export const RefreshCw = createIcon('RefreshCw');
export const Save = createIcon('Save');
export const Send = createIcon('Send');
export const Share2 = createIcon('Share2');
export const ShieldCheck = createIcon('ShieldCheck');
export const Trash2 = createIcon('Trash2');
export const Upload = createIcon('Upload');
export const UserCircle = createIcon('UserCircle');
export const XCircle = createIcon('XCircle');
