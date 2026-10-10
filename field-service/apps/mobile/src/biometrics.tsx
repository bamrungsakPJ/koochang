import { useEffect, useState } from 'react';
import { Platform, Switch } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { keys, storage } from './storage';
import { Banner, Button, Card, Row, Screen, Title, useErrorText, useT } from './ui';

async function available() {
  return Platform.OS !== 'web' && await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
}
async function verify(prompt: string, cancel: string) {
  return await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, biometricsSecurityLevel: 'strong' });
}
export function BiometricSetting() {
  const t = useT(), errorText = useErrorText();
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { void storage.get(keys.biometric).then(v => setEnabled(v === 'true')); }, []);
  if (Platform.OS === 'web') return null;
  async function toggle(value: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (value) {
        if (!await available()) { setError(t('biometricUnavailable')); return; }
        if (!(await verify(t('biometricPrompt'), t('cancel'))).success) return;
      }
      await storage.set(keys.biometric, value ? 'true' : null, true); setEnabled(value);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <Card padded={false}><Row icon="finger-print" tone="teal" title={t('biometricUnlock')} last
    trailing={<Switch accessibilityLabel={t('biometricUnlock')} value={enabled} disabled={busy} onValueChange={v => void toggle(v)} />} /><Banner text={error} /></Card>;
}
export function Unlock({ onUnlock, onPassword }: { onUnlock: () => Promise<void>; onPassword: () => Promise<void> }) {
  const t = useT(), errorText = useErrorText();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function unlock() {
    setBusy(true); setError(null);
    try {
      if (!await available()) { setError(t('biometricUnavailable')); return; }
      if ((await verify(t('biometricPrompt'), t('cancel'))).success) await onUnlock();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void unlock(); }, []);
  return <Screen><Title>{t('biometricLocked')}</Title><Banner text={error} />
    <Button icon="finger-print" title={t('biometricUnlock')} busy={busy} onPress={unlock} />
    <Button kind="ghost" title={t('usePassword')} disabled={busy} onPress={onPassword} /></Screen>;
}
