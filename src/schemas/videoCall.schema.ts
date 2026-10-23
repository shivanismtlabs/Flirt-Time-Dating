import { z } from 'zod';

const VIDEO_CALL_TYPES = new Set(['video', 'video_call', 'videocall', 'video_calling']);
const AUDIO_CALL_TYPES = new Set([
  'audio',
  'voice',
  'voice_call',
  'voicecall',
  'audio_call',
  'audiocall',
  'call',
  'calling',
  'phone',
]);

/**
 * OneVibe uses `type: "audio" | "video"` and treats a normal call as audio.
 * Voice aliases (`voice`, `calling`, `phone`) are audio. Only an explicit
 * video type starts a video call. `fallback` covers a missing type.
 */
export function resolveCallMediaType(
  input: any,
  fallback: 'audio' | 'video' = 'audio'
): 'audio' | 'video' {
  const raw =
    input?.callType ??
    input?.call_type ??
    input?.mediaType ??
    input?.media_type ??
    input?.type;
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return fallback;
  if (VIDEO_CALL_TYPES.has(normalized)) return 'video';
  if (AUDIO_CALL_TYPES.has(normalized)) return 'audio';
  return fallback;
}

export const initiateVideoCallSchema = z.object({
  body: z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
      const rawCallee =
        val.calleeId ||
        val.userId ||
        val.receiverId ||
        val.callee_id ||
        val.receiver_id ||
        val.recipientId ||
        val.recipient_id ||
        val.targetUserId;
      const calleeId = typeof rawCallee === 'string' && rawCallee.trim() ? rawCallee.trim() : undefined;
      const rawConv = val.conversationId !== undefined ? val.conversationId : val.conversation_id;
      const conversationId =
        typeof rawConv === 'string' && rawConv.trim() ? rawConv.trim() : null;
      const callType = resolveCallMediaType(val, 'video');

      return {
        ...val,
        calleeId,
        conversationId,
        callType,
      };
    }
    return val;
  }, z.object({
    calleeId: z.string().uuid({ message: 'calleeId must be a valid UUID' }).optional(),
    conversationId: z.string().uuid({ message: 'conversationId must be a valid UUID' }).optional().nullable(),
    callType: z.enum(['video', 'audio']).optional().default('video'),
  }).refine((data) => Boolean(data.calleeId || data.conversationId), {
    message: 'calleeId or conversationId is required',
  })),
});

export const callIdParamSchema = z.object({
  params: z.object({
    callId: z.string().uuid({ message: 'callId must be a valid UUID' }).optional(),
    id: z.string().uuid({ message: 'id must be a valid UUID' }).optional(),
  }).optional(),
  body: z.object({
    callId: z.string().uuid({ message: 'callId must be a valid UUID' }).optional(),
    id: z.string().uuid({ message: 'id must be a valid UUID' }).optional(),
  }).optional(),
}).refine((data) => {
  const cid = data.params?.callId || data.params?.id || data.body?.callId || data.body?.id;
  return Boolean(cid && typeof cid === 'string');
}, {
  message: 'callId parameter or body field is required and must be a valid UUID',
});

export const getCallHistorySchema = z.object({
  query: z
    .object({
      page: z.union([z.string(), z.number()]).optional(),
      limit: z.union([z.string(), z.number()]).optional(),
      search: z.string().trim().max(100).optional(),
      query: z.string().trim().max(100).optional(),
      q: z.string().trim().max(100).optional(),
      callType: z.enum(['video', 'audio']).optional(),
    })
    .optional(),
});

export type InitiateVideoCallInput = z.infer<typeof initiateVideoCallSchema>['body'];
export type CallIdParamInput = z.infer<typeof callIdParamSchema>['params'];
export type GetCallHistoryQuery = z.infer<typeof getCallHistorySchema>['query'];

