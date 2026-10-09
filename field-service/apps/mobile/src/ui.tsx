import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Language } from '@field-service/core';
import { translate, type TranslationKey } from '@field-service/i18n';
import { ApiFailure } from './api';

export const colors = {
  bg: '#F6F7F9', surface: '#FFFFFF', ink: '#14263B', muted: '#657080', faint: '#7C8898', line: '#E8EBEF',
  // KooChang brand (branding/koochang): navy actions, amber accent.
  primary: '#14263B', primaryPressed: '#0B1828', primarySoft: '#EDF1F6', onPrimary: '#FFFFFF',
  accent: '#F6AF37', accentSoft: '#FFF1D9',
  success: '#16A34A', successSoft: '#DCFCE7', warn: '#B45309', warnSoft: '#FEF3C7',
  danger: '#DC2626', dangerSoft: '#FEE2E2',
};

/** Secondary tones: [soft background, strong foreground]. Navy stays the action colour. */
export const tones = {
  blue: ['#EFF4FF', '#1D4ED8'], teal: ['#CCFBF1', '#0F766E'], amber: ['#FEF3C7', '#B45309'], violet: ['#EDE9FE', '#6D28D9'],
  rose: ['#FFE4E6', '#BE123C'], sky: ['#E0F2FE', '#0369A1'], green: ['#DCFCE7', '#15803D'],
} as const;
export type Tone = keyof typeof tones;

/** Noto Sans Thai per weight (Android ignores fontWeight with custom fonts). */
export const fonts = {
  regular: 'NotoSansThai_400Regular', medium: 'NotoSansThai_500Medium', semibold: 'NotoSansThai_600SemiBold', bold: 'NotoSansThai_700Bold',
};
const text = (family: keyof typeof fonts, size: number, color: string, lineHeight = Math.round(size * 1.5)): TextStyle =>
  ({ fontFamily: fonts[family], fontSize: size, lineHeight, color });

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) =>
  <Ionicons name={name} size={size} color={color} />;

/** Rounded square with a coloured icon. */
export const IconTile = ({ icon, tone: _tone = 'blue', size = 40 }: { icon: IconName; tone?: Tone; size?: number }) =>
  <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: colors.primarySoft }]}>
    <Icon name={icon} size={size * 0.5} color={colors.primary} />
  </View>;

export const LanguageContext = createContext<Language>('th');
export function useT() {
  const language = useContext(LanguageContext);
  return (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params);
}

/** Message for any failure: the API already localizes its message; network errors are local. */
export function useErrorText() {
  const t = useT();
  return (error: unknown): string => {
    if (error instanceof Error && error.message === 'SESSION_STORAGE_UNAVAILABLE') return t('sessionStorageUnavailable');
    if (error instanceof ApiFailure) return error.code === 'NETWORK_ERROR' || !error.message ? t('networkError') : error.message;
    return t('INTERNAL_ERROR');
  };
}

/** Android hardware back: the newest mounted Screen that shows a back arrow handles it exactly like the arrow. */
const backStack: { current?: () => void }[] = [];
export function handleScreenBack(): boolean {
  const top = backStack[backStack.length - 1];
  if (!top?.current) return false;
  top.current();
  return true;
}

export function Screen({ children, onBack, footer }: { children: ReactNode; onBack?: () => void; footer?: ReactNode }) {
  const t = useT();
  const back = useRef(onBack);
  back.current = onBack;
  const hasBack = !!onBack;
  useEffect(() => {
    if (!hasBack) return;
    backStack.push(back);
    return () => { const i = backStack.lastIndexOf(back); if (i >= 0) backStack.splice(i, 1); };
  }, [hasBack]);
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={onBack} style={styles.back} hitSlop={12}>
        <Icon name="chevron-back" size={22} color={colors.ink} />
      </Pressable> : null}
      {children}
    </ScrollView>
    {footer ? <View style={styles.footer}>{footer}</View> : null}
  </KeyboardAvoidingView>;
}

/** Optional fields stay mounted: folding details never clears form values or photo state. */
export function Disclosure({ title, children, initiallyOpen = false }: { title: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.disclosure}>
      <Text style={styles.disclosureText}>{title}</Text><Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
    </Pressable>
    <View style={!open ? { display: 'none' } : undefined}>{children}</View>
  </View>;
}

export const Title = ({ children }: { children: ReactNode }) => <Text accessibilityRole="header" style={styles.title}>{children}</Text>;
export const Sub = ({ children, center }: { children: ReactNode; center?: boolean }) => <Text style={[styles.sub, center && { textAlign: 'center' }]}>{children}</Text>;
export const Section = ({ children, action }: { children: ReactNode; action?: ReactNode }) =>
  <View style={styles.sectionRow}><Text accessibilityRole="header" style={styles.section}>{children}</Text>{action}</View>;
export const Card = ({ children, padded = true }: { children: ReactNode; padded?: boolean }) => <View style={[styles.card, padded && styles.cardPad]}>{children}</View>;
export const Strong = ({ children }: { children: ReactNode }) => <Text style={styles.strong}>{children}</Text>;

export function Steps({ step, total }: { step: number; total: number }) {
  return <View style={styles.steps} accessibilityLabel={`${step}/${total}`}>
    {Array.from({ length: total }, (_, i) => <View key={i} style={[styles.step, i < step && styles.stepOn]} />)}
  </View>;
}

export function Field({ label, error, hint, icon, big, required, ...input }: TextInputProps & { label: string; error?: string; hint?: string; icon?: IconName; big?: boolean; required?: boolean }) {
  const t = useT();
  return <View style={styles.field}>
    <Text style={styles.label}>{label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}</Text>
    <View style={[styles.inputBox, error ? styles.inputBoxError : null]}>
      {icon ? <Icon name={icon} size={20} color={colors.faint} /> : null}
      <TextInput placeholderTextColor={colors.faint} {...input} accessibilityLabel={required ? `${label}, ${t('requiredField')}` : label} style={[styles.input, big && styles.inputBig]} />
    </View>
    {error ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

export function Button({ title, onPress, kind = 'primary', icon, busy, disabled, small }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; busy?: boolean; disabled?: boolean; small?: boolean;
}) {
  const off = disabled || busy;
  const tint = kind === 'primary' ? colors.onPrimary : kind === 'danger' ? colors.danger : colors.primary;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => [styles.button, small && styles.buttonSmall, styles[kind], pressed && (kind === 'primary' ? styles.primaryPressed : styles.pressed), off && styles.disabled]}>
    {busy ? <ActivityIndicator color={tint} /> : <>
      {icon ? <Icon name={icon} size={small ? 16 : 20} color={tint} /> : null}
      <Text style={[small ? styles.buttonTextSmall : styles.buttonText, { color: tint }]}>{title}</Text>
    </>}
  </Pressable>;
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Icon name={icon} size={20} color={colors.primary} /></Pressable>;
}

export function Banner({ text, tone = 'error' }: { text?: string | null; tone?: 'error' | 'info' | 'success' }) {
  if (!text) return null;
  const palette = tone === 'error' ? [colors.dangerSoft, colors.danger, 'alert-circle'] as const
    : tone === 'success' ? [colors.successSoft, colors.success, 'checkmark-circle'] as const : [colors.primarySoft, colors.primary, 'information-circle'] as const;
  return <View style={[styles.banner, { backgroundColor: palette[0] }]} accessibilityRole="alert">
    <Icon name={palette[2]} size={20} color={palette[1]} />
    <Text style={[styles.bannerText, { color: palette[1] }]}>{text}</Text>
  </View>;
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warn' | 'ok' | 'danger' | 'info' }) {
  const [bg, fg] = { neutral: [colors.line, colors.muted], warn: [colors.warnSoft, colors.warn], ok: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger], info: [colors.primarySoft, colors.primary] }[tone];
  return <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: fg }]}>{text}</Text></View>;
}

/** Circle with the first letter of a name; a person icon when the name is only a phone number. */
export function Avatar({ name, size = 44, tone = 'blue' }: { name: string; size?: number; tone?: Tone }) {
  const first = Array.from(name.trim())[0];
  const [bg, fg] = tones[tone];
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
    {!first || /[+\d]/.test(first) ? <Icon name="person" size={size * 0.5} color={fg} />
      : <Text style={[styles.avatarText, { fontSize: size * 0.4, lineHeight: size * 0.6, color: fg }]}>{first.toUpperCase()}</Text>}
  </View>;
}

/** Tappable or plain row: icon, title, subtitle, trailing content. */
export function Row({ icon, tone = 'blue', title, subtitle, below, trailing, onPress, last }: { icon?: IconName | ReactNode; tone?: Tone; title: string; subtitle?: string; below?: ReactNode; trailing?: ReactNode; onPress?: () => void; last?: boolean }) {
  const body = <>
    {typeof icon === 'string' ? <IconTile icon={icon as IconName} tone={tone} /> : icon}
    <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{title}</Text>{subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}{below ? <View style={{ flexDirection: 'row', marginTop: 4 }}>{below}</View> : null}</View>
    {trailing ? <View style={{ alignSelf: 'center' }}>{trailing}</View> : (onPress ? <Icon name="chevron-forward" size={18} color={colors.faint} /> : null)}
  </>;
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: colors.bg }]}>{body}</Pressable>
    : <View style={[styles.row, !last && styles.rowLine]}>{body}</View>;
}

export function TabBar<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: string; icon: IconName; badge?: number }[]; active: T; onChange: (key: T) => void }) {
  return <View style={styles.tabBar} accessibilityRole="tablist">
    {tabs.map(tab => {
      const on = tab.key === active;
      return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab.key)} style={styles.tab}>
        <View style={[styles.tabMarker, on && styles.tabMarkerOn]} />
        <View>
          <Icon name={(on ? tab.icon : `${tab.icon}-outline`) as IconName} size={24} color={on ? colors.primary : colors.faint} />
          {tab.badge ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{tab.badge}</Text></View> : null}
        </View>
        <Text style={[styles.tabLabel, on && { color: colors.primary, fontFamily: fonts.semibold }]}>{tab.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export const Loading = () => <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.primary} size="large" /></View>;

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
  content: { padding: 20, paddingTop: 20, paddingBottom: 40, maxWidth: 560, width: '100%', alignSelf: 'center' },
  footer: { padding: 20, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: colors.line },
  title: text('bold', 26, colors.ink, 38),
  sub: { ...text('regular', 15, colors.muted, 23), marginTop: 4 },
  strong: text('semibold', 17, colors.ink, 26),
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  section: text('semibold', 15, colors.muted, 22),
  card: { backgroundColor: colors.surface, borderRadius: 16, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardPad: { padding: 16 },
  steps: { flexDirection: 'row', gap: 6, marginVertical: 18 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  stepOn: { backgroundColor: colors.primary },
  field: { marginTop: 16 },
  label: { ...text('medium', 14, colors.ink, 20), marginBottom: 8 },
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14 },
  inputBoxError: { borderColor: colors.danger },
  input: { flex: 1, paddingVertical: 13, ...text('regular', 17, colors.ink, 24) },
  inputBig: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 36, letterSpacing: 10, textAlign: 'center' },
  fieldError: { ...text('regular', 13, colors.danger, 20), marginTop: 6 },
  hint: { ...text('regular', 13, colors.muted, 20), marginTop: 6 },
  button: { minHeight: 52, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 },
  buttonSmall: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, marginTop: 0 },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSoft },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  buttonText: text('semibold', 16, colors.onPrimary, 22),
  buttonTextSmall: text('semibold', 14, colors.onPrimary, 20),
  iconButton: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, marginTop: 8 },
  disclosureText: { flex: 1, ...text('medium', 13, colors.muted, 20) },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 12, padding: 12, marginTop: 14 },
  bannerText: { flex: 1, ...text('regular', 14, colors.ink, 21) },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: text('semibold', 12, colors.muted, 18),
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.semibold, color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  tile: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: text('medium', 16, colors.ink, 23),
  rowSub: text('regular', 13, colors.muted, 19),
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, paddingBottom: 10 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, gap: 2 },
  // Amber bar over the active tab (amber is an accent only: too light for text on white).
  tabMarker: { width: 28, height: 3, borderRadius: 2, marginTop: -8, marginBottom: 5, backgroundColor: 'transparent' },
  tabMarkerOn: { backgroundColor: colors.accent },
  tabLabel: text('medium', 12, colors.faint, 16),
  tabBadge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, color: colors.onPrimary },
});
