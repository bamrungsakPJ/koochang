import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Session tokens live in the device keychain/keystore; web builds fall back to localStorage. */
export const storage = {
  async get(key: string): Promise<string | null> {
    try { return Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key); }
    catch { return null; }
  },
  async set(key: string, value: string | null, required = false): Promise<void> {
    try {
      if (Platform.OS === 'web') { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      else if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch { if (required) throw new Error('SESSION_STORAGE_UNAVAILABLE'); }
  },
};

export const keys = {
  language: 'foundation.language',
  tokens: 'session.tokens',
  biometric: 'session.biometric',
  access: 'session.access',
  refresh: 'session.refresh',
  organization: 'session.organization',
};
