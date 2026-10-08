/**
 * SMS Provider Abstraction Interface
 */
export interface ISmsProvider {
  sendOtp(phone: string, otp: string): Promise<boolean>;
}

/**
 * Default SMS Provider implementation
 * In production, this connects to Twilio / AWS SNS / MessageBird / Firebase
 * In dev/test, this safely simulates SMS dispatch without leaking secrets.
 */
export class DefaultSmsProvider implements ISmsProvider {
  public async sendOtp(phone: string, _otp: string): Promise<boolean> {
    // In production, integrate external SMS provider here
    // Note: Never log the plain OTP or OTP hash in logs
    if (process.env.NODE_ENV === 'development') {
      console.log(`[SMS Provider] OTP sent to ${phone.slice(0, 4)}***${phone.slice(-2)}`);
    }
    return true;
  }
}

export const smsProvider: ISmsProvider = new DefaultSmsProvider();
