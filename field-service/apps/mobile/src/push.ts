import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { Language } from '@field-service/core';
import { translate } from '@field-service/i18n';
import { api } from './api';
import { storage } from './storage';

/** Push through Firebase Cloud Messaging, Android only for now. Expo Go cannot receive remote
 * pushes, so this works only in a development build or a store build with google-services.json.
 * The in-app inbox stays the source of truth; a push is only a nudge to open it. */
export interface PushTarget { organizationId: string }

const tokenKey = 'push.token';
const supported = Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
// Loaded lazily: importing expo-notifications inside Expo Go prints an unsupported-push error.
const notifications = () => import('expo-notifications');

async function send(token: string) {
  if (!api.signedIn) return;
  await api.registerDevice(token, 'android');
  await storage.set(tokenKey, token);
}

/** Asks for permission (Android 13+ shows the system prompt once) and registers the FCM token
 * for the signed-in account. Failures are silent: the inbox still works without push. */
export async function registerPush(language: Language): Promise<void> {
  if (!supported) return;
  try {
    const Notifications = await notifications();
    await Notifications.setNotificationChannelAsync('default', {
      name: translate(language, 'notifications'), importance: Notifications.AndroidImportance.HIGH });
    // Check the native response explicitly; some SDK declarations omit inherited permission fields.
    const granted = (permission: object) => 'granted' in permission && permission.granted === true;
    let permission = await Notifications.getPermissionsAsync();
    if (!granted(permission)) permission = await Notifications.requestPermissionsAsync();
    if (!granted(permission)) return;
    const device = await Notifications.getDevicePushTokenAsync();
    if (typeof device.data === 'string') await send(device.data);
  } catch { /* no Firebase config in this build, or offline: retried on next start */ }
}

/** Removes this phone from the account before signing out, so the next person on it never gets
 * the previous account's pushes. */
export async function unregisterPush(): Promise<void> {
  const token = await storage.get(tokenKey);
  if (!token) return;
  try { await api.removeDevice(token); } catch { /* the server also skips pushes for a reassigned token */ }
  await storage.set(tokenKey, null);
}

/** Shows pushes while the app is open, re-registers a rotated token and reports taps (including
 * the tap that launched the app). Returns a cleanup function. */
export function listenForPush(onOpen: (target: PushTarget) => void): () => void {
  if (!supported) return () => {};
  let stopped = false;
  const cleanups: (() => void)[] = [];
  void notifications().then(async Notifications => {
    if (stopped) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const open = (response: { notification: { request: { content: { data?: Record<string, unknown> | null } } } } | null) => {
      const id = response?.notification.request.content.data?.organization_id;
      if (typeof id === 'string' && id) onOpen({ organizationId: id });
    };
    const tokens = Notifications.addPushTokenListener(token => { if (typeof token.data === 'string') void send(token.data).catch(() => {}); });
    const taps = Notifications.addNotificationResponseReceivedListener(open);
    cleanups.push(() => tokens.remove(), () => taps.remove());
    open(await Notifications.getLastNotificationResponseAsync().catch(() => null));
    Notifications.clearLastNotificationResponse?.();
  }).catch(() => {});
  return () => { stopped = true; cleanups.forEach(c => c()); };
}
