import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPhone, isThaiMobile, normalizePhone, type Language } from '@field-service/core';
import type { TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, tokenFromLink, type Challenge } from '../api';
import { Banner, Button, Card, colors, Field, fonts, Icon, IconTile, Loading, Screen, Steps, Sub, Title, useErrorText, useT, type IconName, type Tone } from '../ui';

export function LanguageSwitch({ language, onChange }: { language: Language; onChange: (value: Language) => void }) {
  return <View style={styles.languages} accessibilityRole="radiogroup">
    {(['th', 'en'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: language === value }}
      onPress={() => onChange(value)} style={[styles.language, language === value && styles.languageOn]}>
      <Text style={[styles.languageText, language === value && styles.languageTextOn]}>{value === 'th' ? 'ไทย' : 'EN'}</Text>
    </Pressable>)}
  </View>;
}

function Feature({ icon, tone, text }: { icon: IconName; tone: Tone; text: string }) {
  return <View style={styles.feature}>
    <IconTile icon={icon} tone={tone} />
    <Text style={styles.featureText}>{text}</Text>
  </View>;
}

export function Welcome({ language, onLanguage, onCreate, onSignIn, onJoin }: {
  language: Language; onLanguage: (value: Language) => void; onCreate: () => void; onSignIn: () => void; onJoin: () => void;
}) {
  const t = useT();
  return <Screen footer={<>
    <Button title={t('createShop')} icon="storefront" onPress={onCreate} />
    <Button title={t('joinShop')} icon="link" kind="secondary" onPress={onJoin} />
    <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signInRow}>
      <Text style={styles.signInText}>{t('haveAccount')} <Text style={styles.signInLink}>{t('signIn')}</Text></Text>
    </Pressable>
  </>}>
    <View style={styles.topRow}>
      <View style={styles.brandRow}><View style={styles.logo}><Icon name="construct" size={20} color={colors.onPrimary} /></View>
        <Text style={styles.brand}>{t('appName')}</Text></View>
      <LanguageSwitch language={language} onChange={onLanguage} />
    </View>
    <Text style={styles.heroTitle}>{t('welcomeTitle')}</Text>
    <Sub>{t('welcomeBody')}</Sub>
    <Card>
      <Feature icon="calendar" tone="amber" text={t('featureJobs')} />
      <Feature icon="people" tone="blue" text={t('featureTeam')} />
      <Feature icon="refresh-circle" tone="teal" text={t('featureRepeat')} />
    </Card>
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

  return <Screen onBack={onBack} footer={<Button title={t('next')} icon="arrow-forward" onPress={submit} busy={busy} />}>
    <Sub>{mode === 'register' ? t('createShopHint') : mode === 'join' ? shopPreview : t('signInHint')}</Sub>
    <Title>{mode === 'register' ? t('createShop') : mode === 'join' ? t('joinPreviewTitle') : t('signIn')}</Title>
    {mode !== 'signin' ? <Steps step={1} total={2} /> : null}
    {mode === 'register' ? <Field label={t('shopName')} icon="storefront-outline" value={name} onChangeText={setName} error={errors.name} autoComplete="organization" maxLength={120} /> : null}
    {mode === 'join' ? <Field label={t('yourName')} icon="person-outline" value={name} onChangeText={setName} error={errors.name} hint={t('yourNameHint')} autoComplete="name" maxLength={80} /> : null}
    <Field label={t('phone')} icon="call-outline" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="08x-xxx-xxxx" />
    <Banner text={failure} />
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

  async function verify(value = code) {
    if (!/^\d{6}$/.test(value)) { setError(t('field.code')); return; }
    setBusy(true); setError(null);
    try { await onVerify(challenge.challenge_id, value); }
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

  return <Screen onBack={onBack} footer={<Button title={t('confirm')} icon="checkmark" onPress={() => verify()} busy={busy} />}>
    <View style={styles.otpIcon}><Icon name="chatbubble-ellipses" size={28} color={colors.primary} /></View>
    <Title>{t('otpTitle')}</Title>
    <Sub>{t('otpSentTo', { phone: formatPhone(phone) })}</Sub>
    <Field label={t('otpCode')} big value={code} error={error ?? undefined} keyboardType="number-pad" autoComplete="one-time-code"
      textContentType="oneTimeCode" maxLength={6} autoFocus placeholder="••••••"
      onChangeText={value => { const digits = value.replace(/\D/g, '').slice(0, 6); setCode(digits); if (digits.length === 6 && !busy) void verify(digits); }} />
    {challenge.delivery === 'development' ? <Banner tone="info" text={t('devOtpNotice')} /> : null}
    <View style={styles.resendRow}>
      {wait > 0 ? <Text style={styles.resendWait}>{t('resendIn', { seconds: wait })}</Text>
        : <Pressable accessibilityRole="button" onPress={resend} disabled={busy}><Text style={styles.link}>{t('resend')}</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={onBack}><Text style={styles.link}>{t('changePhone')}</Text></Pressable>
    </View>
  </Screen>;
}

/** Paste a join link (or arrive here from a deep link that had no token). */
export function JoinEntry({ onBack, onToken }: { onBack: () => void; onToken: (token: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const next = () => { const token = tokenFromLink(text); if (token) onToken(token); else setError(t('JOIN_LINK_INVALID')); };
  return <Screen onBack={onBack} footer={<Button title={t('next')} icon="arrow-forward" onPress={next} />}>
    <Title>{t('joinShop')}</Title>
    <Sub>{t('joinPasteHint')}</Sub>
    <Field label={t('joinPasteLabel')} icon="link-outline" value={text} onChangeText={setText} error={error} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
  </Screen>;
}

/** Shows which shop the link belongs to before anything is sent. */
export function JoinPreview({ token, onBack, onContinue, signedInPhone, onUseAnotherPhone }: {
  token: string; onBack: () => void; onContinue: (shopName: string) => void;
  signedInPhone?: string; onUseAnotherPhone: () => Promise<void>;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [state, setState] = useState<{ state: string; organization_name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  async function useAnotherPhone() {
    setSwitching(true); setError(null);
    try { await onUseAnotherPhone(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setSwitching(false); }
  }
  const load = () => { setError(null); api.previewJoinLink(token).then(setState, failure => setError(errorText(failure))); };
  useEffect(load, [token]);

  if (error) return <Screen onBack={onBack} footer={<Button title={t('retry')} icon="refresh" onPress={load} />}><Banner text={error} /></Screen>;
  if (!state) return <Loading />;
  if (state.state !== 'active') return <Screen onBack={onBack}>
    <View style={[styles.otpIcon, { backgroundColor: colors.dangerSoft }]}><Icon name="unlink" size={28} color={colors.danger} /></View>
    <Title>{t('linkInvalidTitle')}</Title>
    <Sub>{state.state === 'closed' ? t('linkClosedBody') : t('linkInvalidBody')}</Sub>
  </Screen>;
  return <Screen onBack={onBack} footer={<>
    <Button title={t('requestJoin')} icon="arrow-forward" disabled={switching} onPress={() => onContinue(state.organization_name ?? '')} />
    {signedInPhone ? <Button title={t('joinUseAnotherPhone')} kind="secondary" busy={switching} onPress={useAnotherPhone} /> : null}
  </>}>
    <Sub>{t('joinPreviewTitle')}</Sub>
    <Card>
      <View style={styles.shopRow}>
        <View style={styles.shopIcon}><Icon name="storefront" size={26} color={colors.primary} /></View>
        <Text style={styles.shopName}>{state.organization_name}</Text>
      </View>
    </Card>
    <Sub>{t('joinWebBody')}</Sub>
    {signedInPhone ? <Banner tone="info" text={t('joinCurrentAccount', { phone: formatPhone(signedInPhone) })} /> : null}
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
  return <Screen onBack={onBack} footer={<Button title={t('requestJoin')} icon="send" onPress={submit} busy={busy} />}>
    <Sub>{shopName}</Sub>
    <Title>{t('joinPreviewTitle')}</Title>
    <Field label={t('yourName')} icon="person-outline" value={name} onChangeText={setName} error={error} hint={t('yourNameHint')} maxLength={80} />
    <Banner text={failure} />
  </Screen>;
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 36 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink, flexShrink: 1 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 46, color: colors.ink },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  featureText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  signInRow: { alignItems: 'center', paddingVertical: 14 },
  signInText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted },
  signInLink: { fontFamily: fonts.semibold, color: colors.primary },
  languages: { flexDirection: 'row', backgroundColor: colors.line, borderRadius: 10, padding: 3 },
  language: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  languageOn: { backgroundColor: colors.surface },
  languageText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.muted },
  languageTextOn: { color: colors.ink },
  otpIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  resendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  resendWait: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
  link: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.primary },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shopIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  shopName: { flex: 1, fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.ink },
});
