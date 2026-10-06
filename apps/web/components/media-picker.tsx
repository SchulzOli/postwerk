'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { formatBytes } from '@postwerk/providers/validate';
import { useLocale, useMessages } from '@/lib/i18n';
import { ACCEPTED_MEDIA, checkMediaUrl, MAX_IMAGE_BYTES, type ComposerMediaInput } from '@/lib/media';
import { uploadMessages } from '@/messages/upload';

/** One attached file in the composer: uploading, uploaded, failed, or added by link. */
export interface ComposerMedia {
  localId: string;
  /** Media id once uploaded; undefined for links. */
  id?: string;
  url: string;
  kind: 'image' | 'video';
  size?: number;
  mimeType?: string;
  altText: string;
  /** 0–1 while uploading. */
  progress?: number;
  error?: string;
}

export const isReady = (item: ComposerMedia) => item.progress === undefined && !item.error;

/** What the form submits for the attached media. */
export function mediaField(items: ComposerMedia[]): string {
  return JSON.stringify(items.filter(isReady).map((item): ComposerMediaInput => (item.id ? { id: item.id, altText: item.altText } : { url: item.url, altText: item.altText })));
}

interface Uploaded {
  id: string;
  url: string;
  kind: 'image' | 'video';
  mimeType: string;
  size: number;
}

function upload(file: File, onProgress: (share: number) => void, t: (typeof uploadMessages)['en']): Promise<Uploaded> {
  // XMLHttpRequest, because fetch cannot report upload progress.
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/media');
    request.setRequestHeader('content-type', file.type);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => {
      let body: { error?: string } & Partial<Uploaded> = {};
      try {
        body = JSON.parse(request.responseText || '{}');
      } catch {
        // Not JSON (e.g. a proxy error page).
      }
      if (request.status < 300 && body.id) resolve(body as Uploaded);
      else reject(new Error(body.error ?? t.failedWithStatus(request.status)));
    };
    request.onerror = () => reject(new Error(t.failedConnection));
    request.send(file);
  });
}

const nextId = () => Math.random().toString(36).slice(2);

interface Props {
  items: ComposerMedia[];
  setItems: Dispatch<SetStateAction<ComposerMedia[]>>;
}

export function MediaPicker({ items, setItems }: Props) {
  const locale = useLocale();
  const t = useMessages(uploadMessages);
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string>();

  // Free the local previews of files that were uploading when the composer went away.
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const update = (localId: string, patch: Partial<ComposerMedia>) => setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const localId = nextId();
      const kind = file.type.startsWith('video/') ? 'video' : 'image';
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      const item: ComposerMedia = { localId, url: preview, kind, size: file.size, mimeType: file.type, altText: '', progress: 0 };
      if (!ACCEPTED_MEDIA.split(',').includes(file.type)) item.error = t.wrongType(file.name);
      else if (kind === 'image' && file.size > MAX_IMAGE_BYTES) item.error = t.imageTooBig(file.name, formatBytes(MAX_IMAGE_BYTES));
      setItems((current) => [...current, item]);
      if (item.error) continue;
      upload(file, (progress) => update(localId, { progress }), t)
        .then((uploaded) => {
          // Keep showing the local preview until the browser has the stored file.
          update(localId, { id: uploaded.id, url: uploaded.url, kind: uploaded.kind, size: uploaded.size, mimeType: uploaded.mimeType, progress: undefined });
          URL.revokeObjectURL(preview);
          previews.current.delete(preview);
        })
        .catch((error: Error) => update(localId, { progress: undefined, error: `${file.name}: ${error.message}` }));
    }
  }

  function addLink() {
    const checked = checkMediaUrl(link, locale);
    if ('error' in checked) return setLinkError(checked.error);
    setItems((current) => [...current, { localId: nextId(), ...checked.media, altText: '' }]);
    setLink('');
    setLinkError(undefined);
  }

  function move(index: number, by: number) {
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item!);
      return next;
    });
  }

  return (
    <div className="stack-sm media-picker">
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
      >
        <span>{t.dropHere}</span>
        <button type="button" className="secondary small" onClick={() => input.current?.click()}>
          {t.chooseFiles}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_MEDIA}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="media-tiles">
          {items.map((item, index) => (
            <li key={item.localId} className={item.error ? 'media-tile has-error' : 'media-tile'}>
              <div className="media-thumb">
                {item.error ? (
                  <span className="media-thumb-error" aria-hidden>!</span>
                ) : item.kind === 'video' ? (
                  <video src={item.url} muted preload="metadata" />
                ) : (
                  <img src={item.url} alt="" />
                )}
                {item.progress !== undefined && (
                  <span className="media-progress" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </span>
                )}
              </div>
              <div className="stack-sm grow">
                {item.error ? (
                  <small className="error">{item.error}</small>
                ) : (
                  <input
                    aria-label={t.altText}
                    placeholder={item.kind === 'video' ? t.describeVideo : t.describeImage}
                    value={item.altText}
                    maxLength={1500}
                    onChange={(e) => update(item.localId, { altText: e.target.value })}
                  />
                )}
                <small className="muted" hidden={Boolean(item.error)}>
                  {item.kind === 'video' ? t.video : t.image}
                  {item.size !== undefined && ` · ${formatBytes(item.size)}`}
                  {!item.id && item.progress === undefined && !item.error && t.viaLink}
                  {item.progress !== undefined && t.uploadingPercent(Math.round(item.progress * 100))}
                </small>
              </div>
              <div className="media-actions">
                <button type="button" className="icon-button" aria-label={t.moveLeft} disabled={index === 0} onClick={() => move(index, -1)}>
                  ‹
                </button>
                <button type="button" className="icon-button" aria-label={t.moveRight} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  ›
                </button>
                <button type="button" className="icon-button" aria-label={t.remove} onClick={() => setItems((current) => current.filter((other) => other.localId !== item.localId))}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="media-link">
        <summary className="small-link">{t.addByLink}</summary>
        <div className="row-tight">
          <input
            type="url"
            placeholder={t.linkPlaceholder}
            aria-label={t.mediaLink}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <button type="button" className="secondary small" disabled={!link.trim()} onClick={addLink}>
            {t.add}
          </button>
        </div>
        {linkError && <small className="error">{linkError}</small>}
      </details>
    </div>
  );
}
