// Phone Number Validation & Normalization Utilities

/**
 * Validates country code format (e.g., '+91', '+1', '91', '1')
 */
export const isValidCountryCode = (countryCode: string): boolean => {
  if (typeof countryCode !== 'string') return false;
  const trimmed = countryCode.trim();
  return /^\+?[1-9]\d{0,3}$/.test(trimmed);
};

/**
 * Validates phone number format (must contain 4-15 numeric digits)
 */
export const isValidPhone = (phone: string): boolean => {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-().]/g, '');
  return /^\d{4,15}$/.test(cleaned);
};

/**
 * Normalizes an arbitrary phone string to international format (starts with '+')
 */
export const normalizePhone = (phone: string): string => {
  if (typeof phone !== 'string') return '';
  let normalized = phone.trim().replace(/[\s\-().]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = `+${normalized}`;
  }
  return normalized;
};

/**
 * Combines country code and phone number into a clean E.164-compatible normalized string
 */
export const combineAndNormalizePhone = (countryCode: string, phone: string): string => {
  if (typeof countryCode !== 'string' || typeof phone !== 'string') return '';
  const cleanCountry = countryCode.trim().replace(/^\+/, '').replace(/\D/g, '');
  const cleanPhone = phone.trim().replace(/\D/g, '');
  if (!cleanCountry || !cleanPhone) return '';
  return `+${cleanCountry}${cleanPhone}`;
};
