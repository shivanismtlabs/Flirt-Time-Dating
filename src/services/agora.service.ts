/**
 * FlirtTime Agora RTC Token Generation and Credentials Service
 * Provides secure, server-side token generation using the official Agora SDK token builder.
 * Fails safely if credentials are not configured — never generates mock or fake tokens.
 */

import crypto from 'crypto';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { env } from '../config/env';

export class AgoraServiceError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(message: string, statusCode = 500, errorCode = 'AGORA_CONFIGURATION_ERROR') {
    super(message);
    this.name = 'AgoraServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, AgoraServiceError.prototype);
  }
}

export interface GenerateRtcTokenParams {
  channelName: string;
  uid: number;
  role?: number;
  tokenExpireSeconds?: number;
  privilegeExpireSeconds?: number;
}

export class AgoraService {
  /**
   * Retrieves the Agora App ID from environment.
   * Throws an explicit error if missing.
   */
  public getAppId(): string {
    const appId = env.AGORA_APP_ID;
    if (!appId || !appId.trim()) {
      throw new AgoraServiceError(
        'Agora App ID is not configured on the server. Please set AGORA_APP_ID.',
        500,
        'AGORA_APP_ID_MISSING'
      );
    }
    return appId.trim();
  }

  /**
   * Retrieves the Agora App Certificate from environment.
   * Throws an explicit error if missing.
   */
  public getAppCertificate(): string {
    const appCertificate = env.AGORA_APP_CERTIFICATE;
    if (!appCertificate || !appCertificate.trim()) {
      throw new AgoraServiceError(
        'Agora App Certificate is not configured on the server. Please set AGORA_APP_CERTIFICATE.',
        500,
        'AGORA_APP_CERTIFICATE_MISSING'
      );
    }
    return appCertificate.trim();
  }

  /**
   * Validates that all required Agora credentials are set and non-empty.
   */
  public validateConfiguration(): boolean {
    const appId = env.AGORA_APP_ID;
    const certificate = env.AGORA_APP_CERTIFICATE;
    return !!(appId && appId.trim() && certificate && certificate.trim());
  }

  /**
   * Generates a cryptographically random, positive 32-bit unsigned integer suitable for Agora RTC numeric UIDs.
   * Range: 100,000 to 999,999,999 (well within the 32-bit unsigned int ceiling 4,294,967,295).
   */
  public generateRtcUid(): number {
    return crypto.randomInt(100000, 999999999);
  }

  /**
   * Generates a distinct pair of non-colliding numeric Agora UIDs for caller and callee.
   */
  public generateParticipantUids(): { callerUid: number; calleeUid: number } {
    const callerUid = this.generateRtcUid();
    let calleeUid = this.generateRtcUid();
    while (calleeUid === callerUid) {
      calleeUid = this.generateRtcUid();
    }
    return { callerUid, calleeUid };
  }

  /**
   * Generates an opaque, clean channel name bound to the call session.
   * Format: call_<callIdWithoutHyphens>
   */
  public generateChannelName(callId: string): string {
    const cleanId = callId.replace(/[^a-zA-Z0-9]/g, '');
    return `call_${cleanId}`;
  }

  /**
   * Generates a secure, short-lived Agora RTC token for a specific user and channel.
   *
   * @param params.channelName Unique Agora channel name
   * @param params.uid Unique numeric UID for the participant
   * @param params.role Agora RTC role (default: PUBLISHER)
   * @param params.tokenExpireSeconds Expiration in seconds (default: AGORA_TOKEN_EXPIRATION_SECONDS or 3600)
   * @param params.privilegeExpireSeconds Privilege expiration in seconds (default: same as tokenExpireSeconds)
   */
  public generateRtcToken(params: GenerateRtcTokenParams): string {
    const appId = this.getAppId();
    const appCertificate = this.getAppCertificate();

    if (!params.channelName || !params.channelName.trim()) {
      throw new AgoraServiceError('Channel name is required for RTC token generation', 400, 'INVALID_CHANNEL_NAME');
    }

    if (typeof params.uid !== 'number' || params.uid <= 0 || !Number.isInteger(params.uid)) {
      throw new AgoraServiceError('A valid positive integer numeric UID is required for RTC token generation', 400, 'INVALID_UID');
    }

    const role = params.role !== undefined ? params.role : RtcRole.PUBLISHER;
    const tokenExpire = params.tokenExpireSeconds || env.AGORA_TOKEN_EXPIRATION_SECONDS || 3600;
    const privilegeExpire = params.privilegeExpireSeconds || tokenExpire;

    try {
      const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        params.channelName,
        params.uid,
        role,
        tokenExpire,
        privilegeExpire
      );

      if (!token || typeof token !== 'string' || !token.trim()) {
        throw new Error('Agora token builder returned an empty token');
      }

      return token;
    } catch (error: any) {
      if (error instanceof AgoraServiceError) {
        throw error;
      }
      throw new AgoraServiceError(
        `Failed to generate Agora RTC token: ${error.message || 'Unknown error'}`,
        500,
        'TOKEN_GENERATION_FAILED'
      );
    }
  }
}

export const agoraService = new AgoraService();
