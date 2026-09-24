export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  DISPATCHER: 'DISPATCHER',
  TECHNICIAN: 'TECHNICIAN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const OtpPurpose = {
  SIGNUP: 'SIGNUP',
  RESET: 'RESET',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
