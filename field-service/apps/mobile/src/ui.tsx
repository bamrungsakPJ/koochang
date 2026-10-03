import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { Language } from '@field-service/core';
import { translate, type TranslationKey } from '@field-service/i18n';
import { ApiFailure } from './api';

export const colors = {
  bg: '#f7f8f3', surface: '#ffffff', ink: '#163b35', muted: '#657b72', line: '#e2eae3',
  accent: '#008570', accentInk: '#ffffff', hero: '#005b4d', lime: '#dbf395', limeInk: '#254a29',
  danger: '#b3261e', dangerBg: '#fde8e6', warnBg: '#fff1df', warnInk: '#7a4b00',
};

export const LanguageContext = createContext<Language>('th');
export function useT() {
  const language = useContext(LanguageContext);
  return (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params);
}

/** Message for any failure: the API already localizes its message; network errors are local. */
export function useErrorText() {
  const t = useT();
  return (error: unknown): string => {
    if (error instanceof ApiFailure) return error.code === 'NETWORK_ERROR' || !error.message ? t('networkError') : error.message;
    return t('INTERNAL_ERROR');
  };
}

export function Screen({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  const t = useT();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {onBack ? <Pressable accessibilityRole="button" onPress={onBack} style={styles.back} hitSlop={12}><Text style={styles.backText}>‹ {t('back')}</Text></Pressable> : null}
    {children}
  </ScrollView>;
}

export const Title = ({ children }: { children: ReactNode }) => <Text accessibilityRole="header" style={styles.title}>{children}</Text>;
export const Sub = ({ children, center }: { children: ReactNode; center?: boolean }) => <Text style={[styles.sub, center && { textAlign: 'center' }]}>{children}</Text>;
export const Section = ({ children }: { children: ReactNode }) => <Text accessibilityRole="header" style={styles.section}>{children}</Text>;
export const Panel = ({ children }: { children: ReactNode }) => <View style={styles.panel}>{children}</View>;

export function Steps({ step, total }: { step: number; total: number }) {
  return <View style={styles.steps} accessibilityLabel={`${step}/${total}`}>
    {Array.from({ length: total }, (_, i) => <View key={i} style={[styles.step, i < step && styles.stepOn]} />)}
  </View>;
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput placeholderTextColor="#9aaba3" {...input} accessibilityLabel={label}
      style={[styles.input, error ? styles.inputError : null]} />
    {error ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

export function Button({ title, onPress, kind = 'primary', busy, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'link' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => [styles.button, styles[kind], off && styles.disabled, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator color={kind === 'primary' ? colors.accentInk : colors.accent} />
      : <Text style={[styles.buttonText, kind === 'primary' ? styles.primaryText : kind === 'danger' ? styles.dangerText : styles.secondaryText]}>{title}</Text>}
  </Pressable>;
}

export function Banner({ text, tone = 'error' }: { text?: string | null; tone?: 'error' | 'info' }) {
  if (!text) return null;
  return <View style={[styles.banner, tone === 'info' && styles.bannerInfo]} accessibilityRole="alert">
    <Text style={[styles.bannerText, tone === 'info' && styles.bannerInfoText]}>{text}</Text>
  </View>;
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warn' | 'ok' | 'danger' }) {
  return <View style={[styles.badge, styles[`badge_${tone}`]]}><Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>{text}</Text></View>;
}

export const Loading = () => <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.accent} size="large" /></View>;

/** Yes/no confirmation that also works in the web build (Alert has no buttons there). */
export function confirm(message: string, okText: string, cancelText: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise(resolve => Alert.alert('', message, [
    { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
    { text: okText, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 22, paddingTop: 52, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 12 },
  backText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 28, lineHeight: 38, fontWeight: '700', color: colors.ink, marginTop: 4 },
  sub: { fontSize: 15, lineHeight: 24, color: colors.muted, marginTop: 6 },
  section: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 26, marginBottom: 8 },
  panel: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, marginTop: 12 },
  steps: { flexDirection: 'row', gap: 6, marginVertical: 16 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  stepOn: { backgroundColor: colors.accent },
  field: { marginTop: 16 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 18, color: colors.ink },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 14, marginTop: 6 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 6 },
  button: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  link: { backgroundColor: 'transparent', minHeight: 44 },
  danger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#f3c4bf' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  primaryText: { color: colors.accentInk },
  secondaryText: { color: colors.accent },
  dangerText: { color: colors.danger },
  banner: { backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, marginTop: 14 },
  bannerText: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  bannerInfo: { backgroundColor: colors.warnBg },
  bannerInfoText: { color: colors.warnInk },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badge_neutral: { backgroundColor: colors.line }, badgeText_neutral: { color: colors.muted },
  badge_warn: { backgroundColor: colors.warnBg }, badgeText_warn: { color: colors.warnInk },
  badge_ok: { backgroundColor: colors.lime }, badgeText_ok: { color: colors.limeInk },
  badge_danger: { backgroundColor: colors.dangerBg }, badgeText_danger: { color: colors.danger },
});
