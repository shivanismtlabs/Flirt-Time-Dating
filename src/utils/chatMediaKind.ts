const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)(\?|#|$)/i;
const AUDIO_NAME = /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus)(\?|#|$)/i;

/** True when a URL or storage key is a photo, not a voice note. */
export function isImageMediaReference(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (raw.startsWith('data:image/')) return true;
  return IMAGE_NAME.test(raw.split('?')[0]);
}

/**
 * A photo must stay an image even when the form field is named voice/audio.
 * Image mime and extension win over the field name.
 */
export function isAudioChatFile(
  file: { mimetype?: string; originalname?: string; fieldname?: string },
  messageType?: string
): boolean {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  if (mime.startsWith('image/') || IMAGE_NAME.test(name)) return false;
  const field = (file.fieldname || '').toLowerCase();
  return (
    mime.startsWith('audio/') ||
    ['audio', 'voice', 'voicenote', 'recording', 'sound'].includes(field) ||
    AUDIO_NAME.test(name) ||
    (messageType === 'audio' && !mime.startsWith('image/'))
  );
}
