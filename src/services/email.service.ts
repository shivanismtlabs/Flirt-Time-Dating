import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Email Provider Abstraction Interface
 */
export interface IEmailProvider {
  sendOtp(email: string, otp: string): Promise<boolean>;
}

/**
 * Nodemailer Email Provider implementation
 * Uses SMTP (Gmail, Mailtrap, SendGrid, AWS SES, Custom SMTP, etc.)
 * Fallback to development logger if SMTP host is not configured.
 */
export class DefaultEmailProvider implements IEmailProvider {
  private transporter: Transporter | null = null;

  constructor() {
    if (env.SMTP_HOST && env.SMTP_USER) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    }
  }

  public async sendOtp(email: string, otp: string): Promise<boolean> {
    const parts = email.split('@');
    const masked = `${parts[0].slice(0, 2)}***@${parts[1] || ''}`;

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
          console.log(`[Email Provider] OTP email sent successfully via Nodemailer to ${masked}`);
        }
        return true;
      } catch (error) {
        console.error(`[Email Provider] Failed to send email via Nodemailer to ${masked}:`, error);
        return false;
      }
    }

    // Dev/Test Fallback when SMTP is not configured
    if (env.NODE_ENV === 'development') {
      console.log(`[Email Provider] (Dev Mode - No SMTP configured) Simulated OTP email dispatch to ${masked}`);
    }
    return true;
  }
}

export const emailProvider: IEmailProvider = new DefaultEmailProvider();
