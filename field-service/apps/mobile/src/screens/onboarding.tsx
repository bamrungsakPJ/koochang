import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPhone, isThaiMobile, normalizePhone, type Language } from '@field-service/core';
import type { TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, tokenFromLink, type Challenge } from '../api';
import { Banner, Button, colors, Field, Panel, Screen, Steps, Sub, Title, useErrorText, useT } from '../ui';

export function LanguageSwitch({ language, onChange }: { language: Language; onChange: (value: Language) => void }) {
  return <View style={styles.languages}>
    {(['th', 'en'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: language === value }}
      onPress={() => onChange(value)} style={[styles.language, language === value && styles.languageOn]}>
      <Text style={styles.languageText}>{value === 'th' ? 'ไทย' : 'English'}</Text>
    </Pressable>)}
  </View>;
}

export function Welcome({ language, onLanguage, onCreate, onSignIn, onJoin }: {
  language: Language; onLanguage: (value: Language) => void; onCreate: () => void; onSignIn: () => void; onJoin: () => void;
}) {
  const t = useT();
  return <Screen>
    <View style={styles.brandRow}><View style={styles.brandMark} /><Text style={styles.brand}>{t('appName')}</Text></View>
    <View style={styles.hero}><Text style={styles.heroTitle}>{t('welcomeTitle')}</Text><Text style={styles.heroBody}>{t('welcomeBody')}</Text></View>
    <Button title={t('createShop')} onPress={onCreate} />
    <Sub center>{t('createShopHint')}</Sub>
    <Button title={t('joinShop')} kind="secondary" onPress={onJoin} />
    <Sub center>{t('joinShopHint')}</Sub>
    <Button title={t('signIn')} kind="link" onPress={onSignIn} />
    <LanguageSwitch language={language} onChange={onLanguage} />
  </Screen>;
}

type PhoneMode = 'register' | 'signin' | 'join';

/** Collects the phone number (plus shop name or display name) and requests a code. */
export function PhoneForm({ mode, shopPreview, onBack, onCodeSent, initialName }: {
  mode: PhoneMode; shopPreview?: string; initialName?: string; onBack: () => void;
  onCodeSent: (phone: string, challenge: Challenge, name: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [name, setName] = useState(initialName ?? '');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: Record<string, string> = {};
    const e164 = normalizePhone(phone);
    if (mode !== 'signin' && !name.trim()) next.name = t('field.required');
    if (!e164 || (e164.startsWith('+66') && !isThaiMobile(e164))) next.phone = t('field.phone');
    setErrors(next); setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try { onCodeSent(e164!, await api.requestOtp(e164!), name.trim()); }
    catch (error) {
      if (error instanceof ApiFailure && error.fieldErrors.phone) setErrors({ phone: t(error.fieldErrors.phone as TranslationKey) });
      else setFailure(errorText(error));
    } finally { setBusy(false); }
  }

  return <Screen onBack={onBack}>
    <Sub>{mode === 'register' ? t('createShopHint') : mode === 'join' ? shopPreview : t('signInHint')}</Sub>
    <Title>{mode === 'register' ? t('createShop') : mode === 'join' ? t('joinPreviewTitle') : t('signIn')}</Title>
    {mode !== 'signin' ? <Steps step={1} total={2} /> : null}
    {mode === 'register' ? <Field label={t('shopName')} value={name} onChangeText={setName} error={errors.name} autoComplete="organization" maxLength={120} /> : null}
    {mode === 'join' ? <Field label={t('yourName')} value={name} onChangeText={setName} error={errors.name} hint={t('yourNameHint')} autoComplete="name" maxLength={80} /> : null}
    <Field label={t('phone')} value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="08x-xxx-xxxx" />
    <Banner text={failure} />
    <Button title={t('next')} onPress={submit} busy={busy} />
  </Screen>;
}

export function OtpForm({ phone, challenge: initial, onBack, onVerify }: {
  phone: string; challenge: Challenge; onBack: () => void; onVerify: (challengeId: string, code: string) => Promise<void>;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(initial.resend_after);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify() {
    if (!/^\d{6}$/.test(code)) { setError(t('field.code')); return; }
    setBusy(true); setError(null);
    try { await onVerify(challenge.challenge_id, code); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError(null);
    try { const next = await api.requestOtp(phone); setChallenge(next); setWait(next.resend_after); setCode(''); }
    catch (failure) {
      if (failure instanceof ApiFailure && failure.retryAfter) setWait(failure.retryAfter);
      setError(errorText(failure));
    } finally { setBusy(false); }
  }

  return <Screen onBack={onBack}>
    <Title>{t('otpTitle')}</Title>
    <Sub>{t('otpSentTo', { phone: formatPhone(phone) })}</Sub>
    <Steps step={2} total={2} />
    <Field label={t('otpCode')} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} error={error ?? undefined}
      keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus />
    {challenge.delivery === 'development' ? <Banner tone="info" text={t('devOtpNotice')} /> : null}
    <Button title={t('confirm')} onPress={verify} busy={busy} />
    {wait > 0 ? <Sub center>{t('resendIn', { seconds: wait })}</Sub> : <Button title={t('resend')} kind="link" onPress={resend} disabled={busy} />}
    <Button title={t('changePhone')} kind="link" onPress={onBack} />
  </Screen>;
}

/** Paste a join link (or arrive here from a deep link that had no token). */
export function JoinEntry({ onBack, onToken }: { onBack: () => void; onToken: (token: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  return <Screen onBack={onBack}>
    <Title>{t('joinShop')}</Title>
    <Sub>{t('joinPasteHint')}</Sub>
    <Field label={t('joinPasteLabel')} value={text} onChangeText={setText} error={error} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
    <Button title={t('next')} onPress={() => { const token = tokenFromLink(text); if (token) onToken(token); else setError(t('JOIN_LINK_INVALID')); }} />
  </Screen>;
}

/** Shows which shop the link belongs to before anything is sent. */
export function JoinPreview({ token, onBack, onContinue }: { token: string; onBack: () => void; onContinue: (shopName: string) => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [state, setState] = useState<{ state: string; organization_name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); api.previewJoinLink(token).then(setState, failure => setError(errorText(failure))); };
  useEffect(load, [token]);

  if (error) return <Screen onBack={onBack}><Banner text={error} /><Button title={t('retry')} onPress={load} /></Screen>;
  if (!state) return <Screen onBack={onBack}><Sub>…</Sub></Screen>;
  if (state.state !== 'active') return <Screen onBack={onBack}>
    <Title>{t('linkInvalidTitle')}</Title>
    <Sub>{state.state === 'closed' ? t('linkClosedBody') : t('linkInvalidBody')}</Sub>
  </Screen>;
  return <Screen onBack={onBack}>
    <Panel><Sub>{t('joinPreviewTitle')}</Sub><Text style={styles.shopName}>{state.organization_name}</Text></Panel>
    <Button title={t('next')} onPress={() => onContinue(state.organization_name ?? '')} />
  </Screen>;
}

/** Name step for a technician who is already signed in (no new code needed). */
export function JoinName({ shopName, onBack, onSubmit, initialName }: { shopName: string; initialName: string; onBack: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useT();
  const errorText = useErrorText();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) { setError(t('field.required')); return; }
    setBusy(true); setFailure(null);
    try { await onSubmit(name.trim()); } catch (e) { setFailure(errorText(e)); } finally { setBusy(false); }
  }
  return <Screen onBack={onBack}>
    <Sub>{shopName}</Sub>
    <Title>{t('joinPreviewTitle')}</Title>
    <Field label={t('yourName')} value={name} onChangeText={setName} error={error} hint={t('yourNameHint')} maxLength={80} />
    <Banner text={failure} />
    <Button title={t('requestJoin')} onPress={submit} busy={busy} />
  </Screen>;
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent },
  brand: { fontSize: 15, fontWeight: '600', color: colors.accent },
  hero: { backgroundColor: colors.hero, borderRadius: 24, padding: 24, marginTop: 24, marginBottom: 20 },
  heroTitle: { color: '#ffffff', fontSize: 28, lineHeight: 38, fontWeight: '700' },
  heroBody: { color: '#d2eee4', fontSize: 15, lineHeight: 24, marginTop: 10 },
  languages: { flexDirection: 'row', gap: 10, marginTop: 24, justifyContent: 'center' },
  language: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: '#e8eeea' },
  languageOn: { backgroundColor: colors.lime },
  languageText: { color: colors.ink, fontSize: 15 },
  shopName: { fontSize: 24, fontWeight: '700', color: colors.ink, marginTop: 4 },
});
