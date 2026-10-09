const { existsSync } = require('node:fs');

/** Adds the Firebase Android config (FCM push) when it is present. The file comes from the
 * Firebase console and stays out of git: locally ./google-services.json, on EAS Build the
 * GOOGLE_SERVICES_JSON file variable. Without it the app builds and runs, only push is off. */
module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  return existsSync(file) ? { ...config, android: { ...config.android, googleServicesFile: file } } : config;
};
