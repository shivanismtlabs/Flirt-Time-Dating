export const LOCAL_DEVICE_MEDIA =
  /^(file|content|ph|assets-library|blob):|^\/var\/|^\/data\/|^\/private\//i;

export function isInvalidImageReferenceString(val: unknown): boolean {
  if (typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower === '[object object]' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'nan' ||
    lower === '{}' ||
    lower === '[]' ||
    lower === '""' ||
    lower === "''"
  );
}

export function isLocalDeviceMediaReference(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return LOCAL_DEVICE_MEDIA.test(trimmed);
}

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
    data.uri,
    data.imageUri,
    data.path,
    data.key,
    data.storageKey,
    data.s3Key,
    data.mediaKey,
    data.publicUrl,
    data.link,
    data.src,
    data.thumbnailUrl,
    data.images,
    data.imageUrls,
    data.image_urls,
    data.photos,
    data.photo,
    data.photoUrls,
    data.photo_urls,
    data.medias,
    data.media,
    data.mediaUrls,
    data.media_urls,
    data.attachments,
    data.attachment,
    data.files,
    data.file,
    data.fileUrls,
    data.file_urls,
    data.urls,
    data.uris,
    data.keys,
    data.imageKeys,
    data.image_keys,
    data.gallery,
    data.pictures,
    data.picture,
    meta?.imageUrl,
    meta?.image,
    meta?.url,
    meta?.uri,
    meta?.path,
    meta?.mediaUrl,
    meta?.fileUrl,
    meta?.key,
    meta?.imageKey,
    meta?.storageKey,
    meta?.s3Key,
    meta?.publicUrl,
    meta?.images,
    meta?.imageUrls,
    meta?.image_urls,
    meta?.photos,
    meta?.photo,
    meta?.photoUrls,
    meta?.photo_urls,
    meta?.medias,
    meta?.media,
    meta?.mediaUrls,
    meta?.media_urls,
    meta?.attachments,
    meta?.attachment,
    meta?.files,
    meta?.file,
    meta?.urls,
    meta?.uris,
    meta?.keys,
    meta?.gallery,
    meta?.pictures,
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
        if (
          trimmed &&
          trimmed !== '__FILE_ATTACHMENT__' &&
          !isInvalidImageReferenceString(trimmed) &&
          !isLocalDeviceMediaReference(trimmed)
        ) {
          return trimmed;
        }
      } else if (typeof item === 'object') {
        const candidate =
          item.key ||
          item.imageKey ||
          item.storageKey ||
          item.s3Key ||
          item.url ||
          item.imageUrl ||
          item.mediaUrl ||
          item.publicUrl ||
          item.photoUrl ||
          item.link ||
          item.src ||
          item.uri ||
          item.path ||
          item.file;
        if (candidate && typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (
            trimmed &&
            !isInvalidImageReferenceString(trimmed) &&
            !isLocalDeviceMediaReference(trimmed)
          ) {
            return trimmed;
          }
        }
      }
    }
  }

  // Check if there are valid arrays (multi-image)
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src) && src.length > 0) {
      const hasValidItem = src.some((it) => {
        if (!it) return false;
        if (typeof it === 'string') {
          return (
            it.trim().length > 0 &&
            !isInvalidImageReferenceString(it) &&
            !isLocalDeviceMediaReference(it)
          );
        }
        if (typeof it === 'object') {
          const c = it.key || it.imageKey || it.url || it.imageUrl || it.uri || it.path;
          return (
            typeof c === 'string' &&
            c.trim().length > 0 &&
            !isInvalidImageReferenceString(c) &&
            !isLocalDeviceMediaReference(c)
          );
        }
        return false;
      });
      if (hasValidItem) return '__MULTI_IMAGE__';
    }
  }

  return undefined;
}

/**
 * Copies a resolved image URL onto content/imageUrl if empty or invalid,
 * and synchronizes messageType / type to 'image'.
 */
export function ensureImageMessageContent(body: Record<string, any> | null | undefined): void {
  if (!body || typeof body !== 'object') return;

  const declaredType = String(body.type || body.messageType || '').toLowerCase();

  // 1. If content is an array, object, or JSON string, unpack candidate
  if (Array.isArray(body.content) && body.content.length > 0) {
    if (!body.images) body.images = [...body.content];
    const first = body.content[0];
    body.content =
      typeof first === 'string'
        ? first
        : first?.key || first?.imageKey || first?.url || first?.imageUrl || first?.uri || first?.path || undefined;
  } else if (typeof body.content === 'object' && body.content !== null) {
    const c = body.content as any;
    body.content =
      c.key || c.imageKey || c.storageKey || c.s3Key || c.url || c.imageUrl || c.uri || c.path || c.mediaUrl || undefined;
  } else if (typeof body.content === 'string') {
    const trimmed = body.content.trim();
    if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.startsWith('{"lat') && !trimmed.startsWith('{"name'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (!body.images) body.images = parsed;
          const first = parsed[0];
          body.content =
            typeof first === 'string'
              ? first
              : first?.key || first?.imageKey || first?.url || first?.imageUrl || first?.uri || first?.path || undefined;
        } else if (typeof parsed === 'object' && parsed !== null) {
          body.content =
            parsed.key || parsed.imageKey || parsed.storageKey || parsed.s3Key || parsed.url || parsed.imageUrl || parsed.uri || parsed.path || parsed.mediaUrl || undefined;
        }
      } catch {}
    }
  }

  // 2. Check if content currently has an invalid string like "[object Object]", "undefined", "null", or local device path
  const currentContent = typeof body.content === 'string' ? body.content.trim() : '';
  const contentIsInvalid =
    !currentContent ||
    isInvalidImageReferenceString(currentContent) ||
    isLocalDeviceMediaReference(currentContent);

  const ref = imageReferenceFromPayload(body, body.metadata);

  if (contentIsInvalid) {
    if (ref) {
      body.content = ref;
    } else {
      // If content was invalid or local device path and no valid uploaded ref exists, clear it so validator rejects with 400
      if (
        declaredType === 'image' ||
        isInvalidImageReferenceString(currentContent) ||
        isLocalDeviceMediaReference(currentContent)
      ) {
        body.content = '';
      }
    }
  }

  // 3. Synchronize type and messageType
  const hasValidImage =
    !!ref ||
    (typeof body.content === 'string' &&
      body.content.trim().length > 0 &&
      !isInvalidImageReferenceString(body.content) &&
      !isLocalDeviceMediaReference(body.content) &&
      (isImageMediaReference(body.content) ||
        body.content.startsWith('chat/') ||
        body.content.startsWith('uploads/')));

  if (declaredType === 'image' || (hasValidImage && !body.type && !body.messageType)) {
    if (body.type !== 'image') body.type = 'image';
    if (body.messageType !== 'image') body.messageType = 'image';
  }

  if (ref && !body.imageUrl && ref.length <= 5000 && !ref.startsWith('__')) {
    body.imageUrl = ref;
  }
}

