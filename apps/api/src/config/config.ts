import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    APP_URL: z.url(),
    COOKIE_SECURE: z.stringbool().default(false),
    TRUST_PROXY: z.stringbool().default(false),
    SMS_MODE: z.enum(['console', 'deesmsx']).default('console'),
    DEESMSX_BASE_URL: z.url().default('https://apicall.deesmsx.com'),
    DEESMSX_API_KEY: z.string().default(''),
    DEESMSX_SECRET_KEY: z.string().default(''),
    /** Sender name approved in the DEESMSX back office. */
    DEESMSX_SENDER: z.string().default(''),
    LINE_AUTH_MODE: z.enum(['dev', 'line']).default('dev'),
    LINE_LOGIN_CHANNEL_ID: z.string().default(''),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (c.NODE_ENV === 'production') {
      if (c.LINE_AUTH_MODE === 'dev') fail('LINE_AUTH_MODE=dev is not allowed in production');
      if (c.SMS_MODE === 'console') fail('SMS_MODE=console is not allowed in production');
      if (!c.COOKIE_SECURE) fail('COOKIE_SECURE must be true in production');
    }
    if (c.SMS_MODE === 'deesmsx' && !(c.DEESMSX_API_KEY && c.DEESMSX_SECRET_KEY && c.DEESMSX_SENDER)) {
      fail('DEESMSX_API_KEY, DEESMSX_SECRET_KEY and DEESMSX_SENDER are required when SMS_MODE=deesmsx');
    }
    if (c.LINE_AUTH_MODE === 'line' && !c.LINE_LOGIN_CHANNEL_ID) {
      fail('LINE_LOGIN_CHANNEL_ID is required when LINE_AUTH_MODE=line');
    }
  });

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
