import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';
import { useFonts, NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold } from '@expo-google-fonts/noto-sans-thai';
import { getLocales } from 'expo-localization';
import { Language, normalizeLanguage } from '@field-service/core';
import { api, tokenFromLink, type Challenge, type JoinLink, type Me } from './src/api';
import { keys, storage } from './src/storage';
import { Banner, Button, colors, Field, LanguageContext, Loading, Screen, Sub, TabBar, Title, useErrorText, useT } from './src/ui';
import { translate } from '@field-service/i18n';
import { JoinEntry, JoinName, JoinPreview, OtpForm, PhoneForm, Welcome } from './src/screens/onboarding';
import { Account, Home, MembershipStatus, NoShop, ShopPicker, ShopReady, TeamScreen } from './src/screens/shop';
import { NotificationsScreen } from './src/screens/notifications';

type Next =
  | { kind: 'register'; shopName: string; idempotencyKey: string }
  | { kind: 'signin' }
  | { kind: 'join'; token: string; shopName: string; displayName: string };
type Route =
  | { screen: 'boot' } | { screen: 'welcome' } | { screen: 'register' } | { screen: 'signin' }
  | { screen: 'joinEntry' } | { screen: 'joinPreview'; token: string }
  | { screen: 'joinPhone'; token: string; shopName: string } | { screen: 'joinName'; token: string; shopName: string }
  | { screen: 'otp'; phone: string; challenge: Challenge; next: Next; back: Route }
  | { screen: 'shopReady'; shopName: string; link: JoinLink | null }
  | { screen: 'shop' } | { screen: 'shops' } | { screen: 'team' } | { screen: 'account' } | { screen: 'notifications' } | { screen: 'offline' };

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

export default function App() {
  const [fontsLoaded] = useFonts({ NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold });
  const [language, setLanguage] = useState<Language>('th');
  const [route, setRoute] = useState<Route>({ screen: 'boot' });
  const [me, setMe] = useState<Me | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const pendingToken = useRef<string | null>(null);

  const selectOrganization = useCallback(async (id: string | null) => {
    setOrganizationId(id); await storage.set(keys.organization, id);
  }, []);

  const loadMe = useCallback(async (preferOrganization?: string) => {
    const next = await api.me();
    setMe(next);
    const saved = preferOrganization ?? organizationId ?? await storage.get(keys.organization);
    const chosen = next.memberships.find(m => m.organization_id === saved)
      ?? next.memberships.find(m => m.status === 'active') ?? next.memberships[0];
    await selectOrganization(chosen?.organization_id ?? null);
    return next;
  }, [organizationId, selectOrganization]);

  const signedOut = useCallback(() => { setMe(null); setOrganizationId(null); setRoute({ screen: 'welcome' }); }, []);

  /** A join link opened from outside the app (camera, chat). */
  const openJoinUrl = useCallback((url: string | null) => {
    const token = url ? tokenFromLink(url) : null;
    if (!token) return;
    setRoute(current => current.screen === 'boot' ? (pendingToken.current = token, current) : { screen: 'joinPreview', token });
  }, []);

  useEffect(() => {
    api.onSignedOut = signedOut;
    const subscription = Linking.addEventListener('url', event => openJoinUrl(event.url));
    void (async () => {
      const saved = await storage.get(keys.language);
      const initial = normalizeLanguage(saved ?? getLocales()[0]?.languageCode);
      setLanguage(initial); api.language = initial;
      openJoinUrl(await Linking.getInitialURL().catch(() => null));
      let next: Route = { screen: 'welcome' };
      if (await api.restore()) {
        try { const loaded = await loadMe(); next = { screen: 'shop' }; if (loaded.user.preferred_language !== initial) { setLanguage(loaded.user.preferred_language); api.language = loaded.user.preferred_language; } }
        // Still signed in but the service is unreachable: offer a retry instead of the welcome page.
        catch { next = api.signedIn ? { screen: 'offline' } : { screen: 'welcome' }; }
      }
      const token = pendingToken.current; pendingToken.current = null;
      setRoute(token ? { screen: 'joinPreview', token } : next);
    })();
    return () => subscription.remove();
  }, []);

  async function changeLanguage(value: Language) {
    setLanguage(value); api.language = value;
    await storage.set(keys.language, value);
    if (api.signedIn) { try { setMe(await api.updateMe({ preferred_language: value })); } catch { /* kept locally */ } }
  }

  async function afterVerify(next: Next, challengeId: string, code: string) {
    const displayName = next.kind === 'join' ? next.displayName : undefined;
    await api.verifyOtp(challengeId, code, displayName);
    if (next.kind === 'register') {
      const created = await api.createOrganization(next.shopName, next.idempotencyKey);
      await loadMe(created.organization.id);
      setRoute({ screen: 'shopReady', shopName: created.organization.name, link: created.join_link });
    } else if (next.kind === 'join') {
      const joined = await api.requestJoin(next.token, next.displayName);
      await loadMe(joined.organization_id);
      setRoute({ screen: 'shop' });
    } else {
      await loadMe();
      setRoute({ screen: 'shop' });
    }
  }

  async function signOut() { await api.signOut(); await storage.set(keys.organization, null); signedOut(); }

  const membership = me?.memberships.find(m => m.organization_id === organizationId);
  const several = (me?.memberships.length ?? 0) > 1;
  let content;
  switch (route.screen) {
    case 'boot': content = <Loading />; break;
    case 'offline': content = <Screen><Banner text={translate(language, 'networkError')} />
      <Button title={translate(language, 'retry')} icon="refresh" onPress={async () => {
        try { await loadMe(); setRoute({ screen: 'shop' }); } catch { if (!api.signedIn) setRoute({ screen: 'welcome' }); }
      }} /></Screen>; break;
    case 'welcome': content = <Welcome language={language} onLanguage={changeLanguage}
      onCreate={() => setRoute({ screen: 'register' })} onSignIn={() => setRoute({ screen: 'signin' })} onJoin={() => setRoute({ screen: 'joinEntry' })} />; break;
    case 'register': content = api.signedIn
      ? <CreateShopSignedIn onBack={() => setRoute({ screen: 'shop' })} onCreated={async (shopName, link, id) => { await loadMe(id); setRoute({ screen: 'shopReady', shopName, link }); }} />
      : <PhoneForm mode="register" onBack={() => setRoute({ screen: 'welcome' })}
        onCodeSent={(phone, challenge, name) => setRoute({ screen: 'otp', phone, challenge, back: route, next: { kind: 'register', shopName: name, idempotencyKey: uuid() } })} />;
      break;
    case 'signin': content = <PhoneForm mode="signin" onBack={() => setRoute({ screen: 'welcome' })}
      onCodeSent={(phone, challenge) => setRoute({ screen: 'otp', phone, challenge, back: route, next: { kind: 'signin' } })} />; break;
    case 'joinEntry': content = <JoinEntry onBack={() => setRoute(api.signedIn ? { screen: 'shop' } : { screen: 'welcome' })} onToken={token => setRoute({ screen: 'joinPreview', token })} />; break;
    case 'joinPreview': content = <JoinPreview token={route.token} onBack={() => setRoute(api.signedIn ? { screen: 'shop' } : { screen: 'welcome' })}
      onContinue={shopName => setRoute(api.signedIn ? { screen: 'joinName', token: route.token, shopName } : { screen: 'joinPhone', token: route.token, shopName })} />; break;
    case 'joinPhone': content = <PhoneForm mode="join" shopPreview={route.shopName} onBack={() => setRoute({ screen: 'joinPreview', token: route.token })}
      onCodeSent={(phone, challenge, name) => setRoute({ screen: 'otp', phone, challenge, back: route, next: { kind: 'join', token: route.token, shopName: route.shopName, displayName: name } })} />; break;
    case 'joinName': content = <JoinName shopName={route.shopName} initialName={me?.user.display_name ?? ''} onBack={() => setRoute({ screen: 'joinPreview', token: route.token })}
      onSubmit={async name => { const joined = await api.requestJoin(route.token, name); await loadMe(joined.organization_id); setRoute({ screen: 'shop' }); }} />; break;
    case 'otp': content = <OtpForm phone={route.phone} challenge={route.challenge} onBack={() => setRoute(route.back)}
      onVerify={(id, code) => afterVerify(route.next, id, code)} />; break;
    case 'shopReady': content = <ShopReady shopName={route.shopName} link={route.link} onDone={() => setRoute({ screen: 'shop' })} />; break;
    case 'notifications': content = membership?.status === 'active'
      ? <NotificationsScreen membership={membership} onBack={() => setRoute({ screen: 'shop' })}
        onOpen={item => setRoute({ screen: item.template_key === 'join_request' && membership.role === 'owner' ? 'team' : 'shop' })} /> : <Loading />; break;
    case 'shops': content = me ? <ShopPicker me={me} onBack={() => setRoute({ screen: 'shop' })} onCreate={() => setRoute({ screen: 'register' })}
      onJoin={() => setRoute({ screen: 'joinEntry' })} onPick={async id => { await selectOrganization(id); setRoute({ screen: 'shop' }); }} /> : <Loading />; break;
    case 'shop': case 'team': case 'account': {
      if (!me) { content = <Loading />; break; }
      const active = membership?.status === 'active';
      // Tabs only for an active membership; pending/suspended/no shop never show business menus.
      if (route.screen === 'shop' && !membership) content = <NoShop onCreate={() => setRoute({ screen: 'register' })} onJoin={() => setRoute({ screen: 'joinEntry' })} />;
      else if (route.screen === 'shop' && membership && !active) content = <MembershipStatus membership={membership} onCheck={async () => { await loadMe(membership.organization_id); }}
        onSwitch={several ? () => setRoute({ screen: 'shops' }) : undefined} onSignOut={signOut} />;
      else if (route.screen === 'team' && membership?.role === 'owner' && active) content = <TeamScreen membership={membership} />;
      else if (route.screen === 'account') content = <Account me={me} language={language} onLanguage={changeLanguage} onSignOut={signOut}
        onSwitch={several || !membership ? () => setRoute({ screen: 'shops' }) : undefined} onBack={active ? undefined : () => setRoute({ screen: 'shop' })} />;
      else if (membership && active) content = <Home me={me} membership={membership} onTeam={() => setRoute({ screen: 'team' })} onNotifications={() => setRoute({ screen: 'notifications' })} />;
      else content = <Loading />;
      if (membership && active) {
        const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
        const tabs = [
          { key: 'shop' as const, label: membership.role === 'owner' ? tr('home') : tr('today'), icon: 'home' as const },
          ...(membership.role === 'owner' ? [{ key: 'team' as const, label: tr('team'), icon: 'people' as const }] : []),
          { key: 'account' as const, label: tr('account'), icon: 'person-circle' as const },
        ];
        content = <View style={styles.root}><View style={styles.root}>{content}</View><TabBar tabs={tabs} active={route.screen} onChange={screen => setRoute({ screen })} /></View>;
      }
      break;
    }
  }
  if (!fontsLoaded) content = <Loading />;
  return <LanguageContext.Provider value={language}>
    <SafeAreaView style={styles.root}><StatusBar barStyle="dark-content" backgroundColor={colors.bg} />{content}</SafeAreaView>
  </LanguageContext.Provider>;
}

/** A signed-in user creating another shop needs no new code. */
function CreateShopSignedIn({ onBack, onCreated }: { onBack: () => void; onCreated: (shopName: string, link: JoinLink | null, id: string) => Promise<void> }) {
  const t = useT();
  const errorText = useErrorText();
  const idempotencyKey = useRef(uuid()).current;
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) { setError(t('field.required')); return; }
    setBusy(true); setFailure(null);
    try { const created = await api.createOrganization(name.trim(), idempotencyKey); await onCreated(created.organization.name, created.join_link, created.organization.id); }
    catch (e) { setFailure(errorText(e)); } finally { setBusy(false); }
  }
  return <Screen onBack={onBack}>
    <Sub>{t('createShopHint')}</Sub>
    <Title>{t('createShop')}</Title>
    <Field label={t('shopName')} value={name} onChangeText={setName} error={error} maxLength={120} />
    <Banner text={failure} />
    <Button title={t('next')} onPress={submit} busy={busy} />
  </Screen>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } });
