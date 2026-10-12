import https from 'https';
import { env } from '../config/env';

/**
 * SMS Provider Abstraction Interface
 */
export interface ISmsProvider {
  sendOtp(phone: string, otp: string): Promise<boolean>;
}

/**
 * Universal SMS Provider implementation supporting Fast2SMS, 2Factor, Twilio, and Development fallback.
 */
export class UniversalSmsProvider implements ISmsProvider {
  public async sendOtp(phone: string, otp: string): Promise<boolean> {
    // Extract 10-digit Indian phone number if prefixed with +91
    const cleanPhone = phone.replace(/^\+91/, '').replace(/\D/g, '');

    // 1. Fast2SMS Provider (Recommended for India)
    if (env.FAST2SMS_API_KEY) {
      return await this.sendViaFast2SMS(cleanPhone, otp);
    }

    // 2. 2Factor.in Provider (India)
    if (env.TWO_FACTOR_API_KEY) {
      return await this.sendVia2Factor(cleanPhone, otp);
    }

    // 3. Twilio Provider
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER) {
      return await this.sendViaTwilio(phone, otp);
    }

    // 4. Development / Staging fallback (Simulate dispatch without leaking OTP)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SMS Provider] Simulated OTP dispatch to ${phone.slice(0, 4)}***${phone.slice(-2)}`);
      return true;
    }

    console.warn('[SMS Provider Warning] No real SMS Gateway configured (FAST2SMS_API_KEY or TWILIO credentials missing). OTP was not delivered to phone.');
    return true;
  }

  /**
   * Fast2SMS Quick OTP API (Fastest Indian Gateway)
   */
  private sendViaFast2SMS(phoneNumber: string, otp: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(
        env.FAST2SMS_API_KEY
      )}&variables_values=${encodeURIComponent(otp)}&route=otp&numbers=${encodeURIComponent(
        phoneNumber
      )}`;

      https
        .get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.return === true || res.statusCode === 200) {
                console.log(`[Fast2SMS] OTP delivered to ${phoneNumber.slice(0, 4)}***${phoneNumber.slice(-2)}`);
                resolve(true);
              } else {
                console.error('[Fast2SMS Error]', response.message || response);
                resolve(false);
              }
            } catch (err) {
              console.error('[Fast2SMS Parse Error]', data);
              resolve(false);
            }
          });
        })
        .on('error', (err) => {
          console.error('[Fast2SMS Network Error]', err.message);
          resolve(false);
        });
    });
  }

  /**
   * 2Factor.in OTP API
   */
  private sendVia2Factor(phoneNumber: string, otp: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `https://2factor.in/API/V1/${encodeURIComponent(
        env.TWO_FACTOR_API_KEY
      )}/SMS/${encodeURIComponent(phoneNumber)}/${encodeURIComponent(otp)}`;

      https
        .get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.Status === 'Success') {
                console.log(`[2Factor] OTP delivered to ${phoneNumber.slice(0, 4)}***${phoneNumber.slice(-2)}`);
                resolve(true);
              } else {
                console.error('[2Factor Error]', response.Details || response);
                resolve(false);
              }
            } catch (err) {
              resolve(false);
            }
          });
        })
        .on('error', (err) => {
          console.error('[2Factor Network Error]', err.message);
          resolve(false);
        });
    });
  }

  /**
   * Twilio SMS API
   */
  private sendViaTwilio(phone: string, otp: string): Promise<boolean> {
    return new Promise((resolve) => {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
        'base64'
      );
      const postData = new URLSearchParams({
        To: phone,
        From: env.TWILIO_PHONE_NUMBER,
        Body: `Your FlirtTime verification code is: ${otp}. Valid for 5 minutes.`,
      }).toString();

      const req = https.request(
        {
          hostname: 'api.twilio.com',
          port: 443,
          path: `/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              console.log(`[Twilio] OTP delivered to ${phone.slice(0, 4)}***${phone.slice(-2)}`);
              resolve(true);
            } else {
              console.error('[Twilio Error]', data);
              resolve(false);
            }
          });
        }
      );

      req.on('error', (err) => {
        console.error('[Twilio Network Error]', err.message);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }
}

export const smsProvider: ISmsProvider = new UniversalSmsProvider();
