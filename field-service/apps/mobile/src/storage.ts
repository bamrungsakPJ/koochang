import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Session tokens live in the device keychain/keystore; web builds fall back to localStorage. */
export const storage = {
  async get(key: string): Promise<string | null> {
    try { return Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key); }
    catch { return null; }
  },
  async set(key: string, value: string | null): Promise<void> {
    try {
      if (Platform.OS === 'web') { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      else if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch { /* storage unavailable: the session just will not survive a restart */ }
  },
};

export const keys = {
  language: 'foundation.language',
  access: 'session.access',
  refresh: 'session.refresh',
  organization: 'session.organization',
};
