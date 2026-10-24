import { useState, type ReactNode } from 'react';
import { videoPreview } from '../../lib/resourceAssignmentPresentation';

export function VideoCard({
  url,
  title,
  note,
  children,
  showTitle = true
}: {
  url: string;
  title: string;
  note?: string;
  children?: ReactNode;
  showTitle?: boolean;
}) {
  const preview = videoPreview(url);
  const [failed, setFailed] = useState('');
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {preview?.thumbnail && failed !== url ? (
        <img
          className="aspect-video max-h-48 w-full bg-gray-950 object-contain"
          src={preview.thumbnail}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        <div className="flex h-24 items-center justify-center bg-emerald-50 text-sm font-semibold text-emerald-900">
          {preview?.host || 'Add a video link'} · External video
        </div>
      )}
      <div className="space-y-3 p-4">
        {showTitle && <h3 className="text-lg font-bold text-gray-950">{title || 'Your video'}</h3>}
        {note && <p className="whitespace-pre-wrap text-gray-700">{note}</p>}
        {children}
      </div>
    </div>
  );
}
