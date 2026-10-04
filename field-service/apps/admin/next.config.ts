export default {
  transpilePackages: ['@field-service/core', '@field-service/i18n'],
  // Hosts other than localhost (a phone on the LAN) that may load dev assets, e.g. "192.168.1.99".
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean),
};
