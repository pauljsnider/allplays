import { useState, type ReactNode } from 'react';
import { createLogger } from '../lib/logger';

const logger = createLogger('AvatarImage');
const reportedFailedSrcs = new Set<string>();

type AvatarImageProps = {
  src: string;
  fallback: ReactNode;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
};

export function AvatarImage({ src, fallback, alt = '', className, loading, decoding }: AvatarImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const handleError = () => {
    if (!reportedFailedSrcs.has(src)) {
      reportedFailedSrcs.add(src);
      logger.warn('Avatar image failed to load; showing fallback', { src });
    }
    setFailedSrc(src);
  };

  if (failedSrc === src) {
    return <>{fallback}</>;
  }

  return <img src={src} alt={alt} className={className} loading={loading} decoding={decoding} onError={handleError} />;
}
