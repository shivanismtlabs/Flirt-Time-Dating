import { z } from 'zod';

export const initiateVideoCallSchema = z.object({
  body: z.object({
    calleeId: z.string({ required_error: 'calleeId is required' }).uuid({ message: 'calleeId must be a valid UUID' }),
    conversationId: z.string().uuid({ message: 'conversationId must be a valid UUID' }).optional().nullable(),
  }),
});

export const callIdParamSchema = z.object({
  params: z.object({
    callId: z.string({ required_error: 'callId parameter is required' }).uuid({ message: 'callId must be a valid UUID' }),
  }),
});

export type InitiateVideoCallInput = z.infer<typeof initiateVideoCallSchema>['body'];
export type CallIdParamInput = z.infer<typeof callIdParamSchema>['params'];
