const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)(\?|#|$)/i;
const AUDIO_NAME = /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus)(\?|#|$)/i;
const LOCAL_DEVICE_MEDIA = /^(file|content|ph|assets-library|blob):/i;

const EXPLICIT_AUDIO_KEYS = [
  'audioUrl',
  'voiceUrl',
  'voiceNoteUrl',
  'recordingUrl',
  'audio',
  'voice',
  'voiceNote',
  'recording',
  'audioFile',
] as const;

const GENERIC_MEDIA_KEYS = [
  'publicUrl',
  'fileUrl',
  'mediaUrl',
  'url',
  'key',
  'mediaKey',
  'fileKey',
  'storageKey',
  's3Key',
  'uri',
  'path',
  'file',
  'media',
  'attachment',
] as const;

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

function readMediaReference(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '__FILE_ATTACHMENT__') return undefined;
    if (LOCAL_DEVICE_MEDIA.test(trimmed)) return undefined;
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return readMediaReference(JSON.parse(trimmed), keys, depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readMediaReference(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of keys) {
      if (!(key in obj)) continue;
      const found = readMediaReference(obj[key], keys, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function firstAudioRef(sources: unknown[], keys: readonly string[]): string | undefined {
  for (const source of sources) {
    const found = readMediaReference(source, keys);
    if (found && !isImageMediaReference(found)) return found;
  }
  return undefined;
}

/**
 * Audio URL or storage key from the body or metadata.
 * Generic url/key fields are used only when the message is already an audio message,
 * so a photo key is not treated as a voice note.
 */
export function audioReferenceFromPayload(
  data: any,
  metadata?: any,
  allowGeneric = false
): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  let meta = metadata !== undefined ? metadata : data.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = undefined;
    }
  }
  const explicit = firstAudioRef(
    [
      data.audioUrl,
      data.audio,
      data.voiceUrl,
      data.voice,
      data.voiceNote,
      data.voiceNoteUrl,
      data.recording,
      data.recordingUrl,
      data.audioFile,
      meta,
    ],
    EXPLICIT_AUDIO_KEYS
  );
  if (explicit || !allowGeneric) return explicit;
  return firstAudioRef(
    [
      data.publicUrl,
      data.mediaKey,
      data.fileKey,
      data.storageKey,
      data.s3Key,
      data.key,
      data.file,
      data.media,
      data.medias,
      data.attachments,
      data.fileUrl,
      data.url,
      data.mediaUrl,
      meta,
    ],
    GENERIC_MEDIA_KEYS
  );
}

/**
 * Copies a nested audio URL onto content/audioUrl.
 * Chat validation requires content, but the app often sends the file only inside metadata.
 */
export function ensureAudioMessageContent(body: Record<string, any> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  const declared = String(body.type || body.messageType || '').toLowerCase();
  if (declared !== 'audio' && declared !== 'voice') return;
  const ref = audioReferenceFromPayload(body, body.metadata, true);
  if (!ref) return;
  if (!body.content || !String(body.content).trim()) body.content = ref;
  if (!body.audioUrl && ref.length <= 5000) body.audioUrl = ref;
}

/**
 * Resolves the first image URL or storage key from anywhere in the payload (images, medias, photos, attachments, etc.)
 */
export function imageReferenceFromPayload(
  data: any,
  metadata?: any
): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  let meta = metadata !== undefined ? metadata : data.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = undefined;
    }
  }

  const sources = [
    data.imageUrl,
    data.image,
    data.mediaUrl,
    data.imageKey,
    data.url,
    data.fileUrl,
    data.images,
    data.imageUrls,
    data.photos,
    data.photo,
    data.photoUrls,
    data.medias,
    data.media,
    data.mediaUrls,
    data.attachments,
    data.attachment,
    data.files,
    data.file,
    meta?.imageUrl,
    meta?.image,
    meta?.images,
    meta?.imageUrls,
    meta?.photos,
    meta?.photo,
    meta?.photoUrls,
    meta?.medias,
    meta?.media,
    meta?.mediaUrls,
    meta?.attachments,
    meta?.attachment,
    meta?.files,
    meta?.file,
  ];

  for (const src of sources) {
    if (!src) continue;
    let list: any[] = [];
    if (Array.isArray(src)) {
      list = src;
    } else if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed || trimmed === '__FILE_ATTACHMENT__') continue;
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          list = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          list = trimmed.includes(',') ? trimmed.split(',') : [trimmed];
        }
      } else if (trimmed.includes(',')) {
        list = trimmed.split(',');
      } else {
        list = [trimmed];
      }
    } else if (typeof src === 'object') {
      list = [src];
    }

    for (const item of list) {
      if (!item) continue;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed && trimmed !== '__FILE_ATTACHMENT__' && !LOCAL_DEVICE_MEDIA.test(trimmed)) {
          return trimmed;
        }
      } else if (typeof item === 'object') {
        const candidate =
          item.url ||
          item.imageUrl ||
          item.mediaUrl ||
          item.photoUrl ||
          item.uri ||
          item.path ||
          item.src ||
          item.key ||
          item.imageKey ||
          item.file;
        if (candidate && typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed && !LOCAL_DEVICE_MEDIA.test(trimmed)) {
            return trimmed;
          }
        }
      }
    }
  }

  // If there are image items, but they were local device refs or empty strings, return placeholder so schema validation does not reject
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src) && src.length > 0) return '__MULTI_IMAGE__';
    if (typeof src === 'string' && src.trim().length > 0 && src.trim() !== '[]' && src.trim() !== '{}') {
      return src.trim();
    }
  }

  return undefined;
}

/**
 * Copies a resolved image URL onto content/imageUrl if empty.
 */
export function ensureImageMessageContent(body: Record<string, any> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  if (Array.isArray(body.content) && body.content.length > 0) {
    if (!body.images) body.images = [...body.content];
    body.content = typeof body.content[0] === 'string' ? body.content[0] : (body.content[0]?.url || body.content[0]?.imageUrl || '__MULTI_IMAGE__');
  } else if (typeof body.content === 'string' && body.content.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(body.content.trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (!body.images) body.images = parsed;
        body.content = typeof parsed[0] === 'string' ? parsed[0] : (parsed[0]?.url || parsed[0]?.imageUrl || '__MULTI_IMAGE__');
      }
    } catch {}
  }

  const ref = imageReferenceFromPayload(body, body.metadata);
  if (!ref) return;
  if (!body.content || !String(body.content).trim()) {
    body.content = ref;
  }
  if (!body.imageUrl && ref.length <= 5000 && !ref.startsWith('__')) {
    body.imageUrl = ref;
  }
}
