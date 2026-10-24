'use client';

import { useRef, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import { brandMessages } from '@/messages/brand';
import { uploadMessages } from '@/messages/upload';
import { uploadFile } from './media-picker';

export interface StoredImage {
  id: string;
  url: string;
}

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * Uploaded images for a form (a logo, a character's reference pictures):
 * submits their ids as JSON in a hidden input named `name`.
 */
export function ImageField({ name, initial, max, disabled }: { name: string; initial: StoredImage[]; max: number; disabled?: boolean }) {
  const t = useMessages(brandMessages);
  const uploadText = useMessages(uploadMessages);
  const input = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initial);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();

  async function add(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!IMAGE_TYPES.split(',').includes(file.type)) return setError(t.onlyImages(file.name));
    setError(undefined);
    setProgress(0);
    try {
      const uploaded = await uploadFile(file, setProgress, uploadText);
      setImages((current) => [...current, { id: uploaded.id, url: uploaded.url }].slice(-max));
    } catch (caught) {
      setError(`${file.name}: ${(caught as Error).message}`);
    } finally {
      setProgress(undefined);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="stack-sm">
      <input type="hidden" name={name} value={JSON.stringify(images.map((image) => image.id))} />
      {images.length > 0 && (
        <div className="image-field">
          {images.map((image) => (
            <figure key={image.id}>
              <img src={image.url} alt="" />
              {!disabled && (
                <button type="button" className="link small-link" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}>
                  {t.remove}
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      {!disabled && images.length < max && (
        <div className="row-tight">
          <input ref={input} type="file" accept={IMAGE_TYPES} hidden onChange={(event) => void add(event.target.files)} />
          <button type="button" className="secondary small" disabled={progress !== undefined} onClick={() => input.current?.click()}>
            {progress !== undefined ? `${t.uploading} ${Math.round(progress * 100)} %` : t.upload}
          </button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
