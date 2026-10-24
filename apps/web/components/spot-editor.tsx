'use client';

import { useActionState, useRef, useState } from 'react';
import { checkSpot, spotTimecodes, timecode, WORDS_PER_SECOND, type SpotContent, type SpotScene } from '@maas/core/marketing';
import { saveSpotPieceAction, uploadSpotToYoutubeAction, type PieceState } from '@/app/(app)/campaigns/piece-actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { spotsMessages } from '@/messages/spots';
import { uploadMessages } from '@/messages/upload';
import { uploadFile } from './media-picker';

const VIDEO_TYPES = 'video/mp4,video/quicktime,video/webm';
const AUDIO_TYPES = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav';

const emptyScene = (): SpotScene => ({ seconds: 3, visual: '', voiceOver: '', onScreenText: '', sound: '', character: false });
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

interface Props {
  pieceId: string;
  title: string;
  format: string;
  audio: boolean;
  target: number;
  content: SpotContent;
  file: { id: string; url: string } | null;
  character: { name: string; catchphrase: string } | null;
}

/** The script scene by scene, directions, the produced file and the YouTube link. */
export function SpotEditor({ pieceId, title, format, audio, target, content, file: initialFile, character }: Props) {
  const t = useMessages(spotsMessages);
  const uploadText = useMessages(uploadMessages);
  const [state, action, pending] = useActionState<PieceState, FormData>(saveSpotPieceAction.bind(null, pieceId), {});
  const [scenes, setScenes] = useState<SpotScene[]>(content.scenes.length ? content.scenes : [emptyScene()]);
  const [file, setFile] = useState(initialFile);
  const [progress, setProgress] = useState<number>();
  const [fileError, setFileError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const times = spotTimecodes(scenes);
  const total = times.at(-1)?.end ?? 0;
  const hints = checkSpot(format, { scenes, directions: '', fileMediaId: file?.id }, character);
  const update = (index: number, patch: Partial<SpotScene>) => setScenes((current) => current.map((scene, at) => (at === index ? { ...scene, ...patch } : scene)));
  const move = (index: number, by: number) =>
    setScenes((current) => {
      const next = [...current];
      const [scene] = next.splice(index, 1);
      next.splice(index + by, 0, scene!);
      return next;
    });

  async function upload(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    if (!(audio ? AUDIO_TYPES : VIDEO_TYPES).split(',').includes(chosen.type)) return setFileError(t.wrongFile(audio));
    setFileError(undefined);
    setProgress(0);
    try {
      const uploaded = await uploadFile(chosen, setProgress, uploadText);
      setFile({ id: uploaded.id, url: uploaded.url });
    } catch (caught) {
      setFileError(`${chosen.name}: ${(caught as Error).message}`);
    } finally {
      setProgress(undefined);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <form onSubmit={keepValues(action)} className="stack-lg">
      <section className="card stack">
        <h2>{t.script}</h2>
        <p className="muted">{t.scriptIntro}</p>
        <label>
          {t.title}
          <input name="title" defaultValue={title} required maxLength={160} />
        </label>
        <input type="hidden" name="scenes" value={JSON.stringify(scenes)} />
        <ol className="scene-list">
          {scenes.map((scene, index) => {
            const words = wordCount(scene.voiceOver);
            const max = Math.floor(scene.seconds * WORDS_PER_SECOND);
            return (
              <li key={index} className="scene stack-sm">
                <div className="row">
                  <strong className="grow">
                    {t.scene(index + 1)} <span className="muted">· {timecode(times[index]!.start)}–{timecode(times[index]!.end)}</span>
                  </strong>
                  <button type="button" className="small secondary" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t.moveUp}>↑</button>
                  <button type="button" className="small secondary" disabled={index === scenes.length - 1} onClick={() => move(index, 1)} aria-label={t.moveDown}>↓</button>
                  <button type="button" className="small secondary" disabled={scenes.length === 1} onClick={() => setScenes((current) => current.filter((_, at) => at !== index))}>
                    {t.removeScene}
                  </button>
                </div>
                <div className="scene-grid">
                  <label>
                    {t.seconds}
                    <input type="number" min={1} max={120} value={scene.seconds} onChange={(e) => update(index, { seconds: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                  </label>
                  <label className="check scene-character">
                    <input type="checkbox" checked={scene.character} onChange={(e) => update(index, { character: e.target.checked })} />
                    {character ? t.character(character.name) : t.characterNone}
                  </label>
                </div>
                {!audio && (
                  <label>
                    {t.visual}
                    <textarea rows={2} value={scene.visual} maxLength={600} placeholder={t.visualPlaceholder} onChange={(e) => update(index, { visual: e.target.value })} />
                  </label>
                )}
                <label>
                  <span className="row-tight">
                    <span className="grow">{t.voiceOver}</span>
                    <small className={words > max ? 'warn-text counter' : 'muted counter'}>
                      {words}/{max}
                    </small>
                  </span>
                  <textarea rows={2} value={scene.voiceOver} maxLength={600} onChange={(e) => update(index, { voiceOver: e.target.value })} />
                </label>
                <div className={audio ? undefined : 'grid-2'}>
                  {!audio && (
                    <label>
                      {t.onScreenText}
                      <input value={scene.onScreenText} maxLength={120} onChange={(e) => update(index, { onScreenText: e.target.value })} />
                    </label>
                  )}
                  <label>
                    {t.sound}
                    <input value={scene.sound} maxLength={200} onChange={(e) => update(index, { sound: e.target.value })} />
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="row">
          <button type="button" className="secondary" disabled={scenes.length >= 20} onClick={() => setScenes((current) => [...current, emptyScene()])}>
            {t.addScene}
          </button>
          <span className={total === target ? 'muted grow align-right' : 'warn-text grow align-right'}>{t.total(total, target)}</span>
        </div>
        {hints.length > 0 && (
          <ul className="warn-list">
            {hints.map((hint) => (
              <li key={JSON.stringify(hint)}>
                {hint.code === 'duration'
                  ? t.hints.duration(hint.total, hint.target)
                  : hint.code === 'tooFast'
                    ? t.hints.tooFast(hint.scene, hint.words, hint.max)
                    : hint.code === 'noCharacter'
                      ? t.hints.noCharacter(hint.name)
                      : hint.code === 'noCatchphrase'
                        ? t.hints.noCatchphrase(hint.name, hint.catchphrase)
                        : t.hints.noFile}
              </li>
            ))}
          </ul>
        )}
        <label>
          {t.directions} <small className="muted">{t.directionsHint}</small>
          <textarea name="directions" rows={3} defaultValue={content.directions} maxLength={2000} />
        </label>
      </section>

      <section className="card stack">
        <h2>{t.file}</h2>
        <small className="muted">{t.fileHint(audio)}</small>
        <input type="hidden" name="file" value={file?.id ?? ''} />
        {file && (audio ? <audio src={file.url} controls className="spot-player" /> : <video src={file.url} controls preload="metadata" className="spot-player" />)}
        <div className="row">
          <input ref={input} type="file" accept={audio ? AUDIO_TYPES : VIDEO_TYPES} hidden onChange={(e) => upload(e.target.files)} />
          <button type="button" className="secondary" disabled={progress !== undefined} onClick={() => input.current?.click()}>
            {progress !== undefined ? t.uploading(Math.round(progress * 100)) : file ? t.replace : t.upload}
          </button>
          {file && (
            <button type="button" className="link" onClick={() => setFile(null)}>
              {t.removeFile}
            </button>
          )}
        </div>
        {fileError && <small className="error">{fileError}</small>}
        {!audio && (
          <label>
            {t.youtubeLink}
            <input name="youtube" defaultValue={content.youtubeVideoId ? `https://youtu.be/${content.youtubeVideoId}` : ''} placeholder="https://youtu.be/…" maxLength={200} />
          </label>
        )}
      </section>

      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
      <button type="submit" disabled={pending || progress !== undefined} className="align-start">{t.save}</button>
    </form>
  );
}

/** Uploads the approved video spot to a connected YouTube channel. */
export function YoutubeUpload({ pieceId, accounts, title, description }: { pieceId: string; accounts: { id: string; handle: string }[]; title: string; description: string }) {
  const t = useMessages(spotsMessages);
  const [state, action, pending] = useActionState<PieceState, FormData>(uploadSpotToYoutubeAction.bind(null, pieceId), {});
  return (
    <form onSubmit={keepValues(action)} className="stack">
      <div className="grid-2">
        <label>
          {t.youtubeAccount}
          <select name="account">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.handle}</option>
            ))}
          </select>
        </label>
        <label>
          {t.privacy}
          <select name="privacy" defaultValue="unlisted">
            <option value="unlisted">{t.privacyOptions.unlisted}</option>
            <option value="public">{t.privacyOptions.public}</option>
            <option value="private">{t.privacyOptions.private}</option>
          </select>
        </label>
      </div>
      <label>
        {t.youtubeTitle}
        <input name="title" defaultValue={title} maxLength={100} required />
      </label>
      <label>
        {t.youtubeDescription}
        <textarea name="description" rows={2} defaultValue={description} maxLength={5000} />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
      <button type="submit" className="align-start" disabled={pending}>{t.uploadToYoutube}</button>
    </form>
  );
}
