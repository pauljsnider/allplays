import {
  getCertificateFilename as legacyGetCertificateFilename,
  renderNodeToPngBlob as legacyRenderNodeToPngBlob
} from '@legacy/certificates/exporter.js';

export const getCertificateFilename = legacyGetCertificateFilename as (...args: any[]) => string;
export const renderNodeToPngBlob = legacyRenderNodeToPngBlob as (...args: any[]) => Promise<Blob>;
