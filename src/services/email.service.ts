import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Email Provider Abstraction Interface
 */
export interface IEmailProvider {
  sendOtp(email: string, otp: string): Promise<boolean>;
  verifyConnection?(): Promise<{ ready: boolean; error?: string }>;
}

/**
 * Nodemailer Email Provider implementation
 * Supports Gmail, AWS SES, SendGrid, Brevo, Mailtrap, or any custom SMTP server.
 * Includes IPv4 resolution, resilient timeouts, connection verification, and test mode simulation.
 */
export class DefaultEmailProvider implements IEmailProvider {
  private transporter: Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = (env.SMTP_HOST || '').trim().toLowerCase();
    const user = (env.SMTP_USER || '').trim();
    const rawPass = (env.SMTP_PASS || '').trim();
    const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');
    // Gmail app passwords have spaces which should be stripped
    const pass = isGmail ? rawPass.replace(/\s+/g, '') : rawPass;

    if (user && (host || isGmail)) {
      if (isGmail) {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
          connectionTimeout: 10000,
          greetingTimeout: 5000,
          socketTimeout: 15000,
        } as any);
      } else {
        this.transporter = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: { user, pass },
          connectionTimeout: 10000,
          greetingTimeout: 5000,
          socketTimeout: 15000,
          tls: {
            rejectUnauthorized: false,
          },
        } as any);
      }
    }
  }

  /**
   * Verify SMTP connection at server boot or diagnostic check
   */
  public async verifyConnection(): Promise<{ ready: boolean; error?: string }> {
    if (!this.transporter) {
      return {
        ready: false,
        error: 'SMTP host or user not configured in environment variables (SMTP_HOST / SMTP_USER).',
      };
    }
    try {
      await this.transporter.verify();
      return { ready: true };
    } catch (error: any) {
      const errMsg = error.response || error.message || String(error);
      return { ready: false, error: errMsg };
    }
  }

  public async sendOtp(email: string, otp: string): Promise<boolean> {
    const parts = email.split('@');
    const masked = `${parts[0].slice(0, 2)}***@${parts[1] || ''}`;

    // Test environment: Never consume real SMTP quota in unit/integration tests
    if (env.NODE_ENV === 'test') {
      return true;
    }

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: env.SMTP_FROM,
          to: email,
          subject: 'Your Verification Code - FlirtTime',
          text: `Your verification code is: ${otp}. It will expire in ${env.OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
              <h2 style="color: #ff2a5f; text-align: center;">FlirtTime Verification Code</h2>
              <p>Hello,</p>
              <p>Your 6-digit verification code is:</p>
              <div style="background-color: #f4f4f5; padding: 15px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #111; border-radius: 6px; margin: 20px 0;">
                ${otp}
              </div>
              <p>This code is valid for <strong>${env.OTP_EXPIRY_MINUTES} minutes</strong>. Do not share this code with anyone for security reasons.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #888; text-align: center;">If you did not request this code, please ignore this email.</p>
            </div>
          `,
        });

        if (env.NODE_ENV === 'development') {
          console.log(`[Email Provider] OTP email sent successfully to ${masked}`);
        }
        return true;
      } catch (error: any) {
        const errCode = error.code || 'UNKNOWN';
        const errDetails = error.response || error.message || String(error);
        console.error(
          `[Email Provider] Failed to send email via SMTP to ${masked} [Code: ${errCode}]:`,
          errDetails
        );
        return false;
      }
    }

    // Dev/Staging Fallback when SMTP is not configured
    if (env.NODE_ENV === 'development') {
      console.log(`[Email Provider] (Dev Mode - No SMTP configured) Simulated OTP email dispatch to ${masked}`);
      return true;
    }

    console.warn(
      `[Email Provider Warning] No SMTP transport configured in production. Cannot send OTP to ${masked}.`
    );
    return false;
  }
}

export const emailProvider: IEmailProvider = new DefaultEmailProvider();
