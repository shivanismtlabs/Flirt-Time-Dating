import { z } from 'zod';

export const initiateVideoCallSchema = z.object({
  body: z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
      const calleeId =
        val.calleeId ||
        val.userId ||
        val.receiverId ||
        val.callee_id ||
        val.receiver_id ||
        val.recipientId ||
        val.recipient_id ||
        val.targetUserId;
      const rawConv = val.conversationId !== undefined ? val.conversationId : val.conversation_id;
      const conversationId =
        typeof rawConv === 'string' && rawConv.trim() ? rawConv.trim() : null;
      const rawCallType = (val.callType || val.call_type || val.type || 'video').toString().toLowerCase();
      const callType = rawCallType === 'audio' ? 'audio' : 'video';

      return {
        ...val,
        calleeId,
        conversationId,
        callType,
      };
    }
    return val;
  }, z.object({
    calleeId: z.string({ required_error: 'calleeId is required' }).uuid({ message: 'calleeId must be a valid UUID' }),
    conversationId: z.string().uuid({ message: 'conversationId must be a valid UUID' }).optional().nullable(),
    callType: z.enum(['video', 'audio']).optional().default('video'),
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

