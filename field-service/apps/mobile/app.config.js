const { existsSync, readFileSync } = require('node:fs');

/** Adds the Firebase Android config (FCM push) when it is present. The file comes from the
 * Firebase console and stays out of git: locally ./google-services.json, on EAS Build the
 * GOOGLE_SERVICES_JSON file variable. Without it the app builds and runs, only push is off.
 *
 * Maps in the app (Google Maps SDK for Android) need an API key with "Maps SDK for Android"
 * enabled: GOOGLE_MAPS_ANDROID_API_KEY, otherwise the Android key of the same Firebase project.
 * Without a key the app shows no map (Google Maps would crash) and keeps the "open in Google Maps" button. */
module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const firebase = existsSync(file);
  let mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || null;
  if (!mapsKey && firebase) {
    try { mapsKey = JSON.parse(readFileSync(file, 'utf8')).client?.[0]?.api_key?.[0]?.current_key || null; } catch { mapsKey = null; }
  }
  return {
    ...config,
    android: { ...config.android, ...(firebase ? { googleServicesFile: file } : {}) },
    plugins: [...(config.plugins ?? []), ['react-native-maps', mapsKey ? { androidGoogleMapsApiKey: mapsKey } : {}]],
    extra: { ...config.extra, mapsEnabled: Boolean(mapsKey) },
  };
};
