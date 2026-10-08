// Normalization utilities
// Phone and email normalization
export const normalizePhone = (phone: string): string => {
  if (typeof phone !== 'string') return '';
  let normalized = phone.trim();
  normalized = normalized.replace(/[\s\-().]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = `+${normalized}`;
  }
  return normalized;
};

export const normalizeEmail = (email: string): string => {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};
