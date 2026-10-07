import { Unlock } from './src/biometrics';
import { About } from './src/screens/about';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold } from '@expo-google-fonts/noto-sans-thai';
import { getLocales } from 'expo-localization';
import * as SplashScreen from 'expo-splash-screen';
import { Language, normalizeLanguage } from '@field-service/core';
import { api, tokenFromLink, type Challenge, type Customer, type CustomerLocation, type Job, type JoinLink, type MaintenanceItem, type Me, type ServiceResult } from './src/api';
import { ServiceDone, ServiceForm } from './src/screens/service';
import { CustomerDetail, CustomerForm, CustomersScreen, LocationForm } from './src/screens/customers';
import { EquipmentDetail, EquipmentForm } from './src/screens/equipment';
import { JobCustomerPicker, JobDetail, JobForm, JobsScreen } from './src/screens/jobs';
import { keys, storage } from './src/storage';
import { Banner, Button, colors, Field, LanguageContext, Loading, Screen, Sub, TabBar, Title, useErrorText, useT } from './src/ui';
import { translate } from '@field-service/i18n';
import { JoinEntry, JoinName, JoinPreview, OtpForm, PasswordSetup, PasswordSignIn, PhoneForm, Welcome } from './src/screens/onboarding';
import { Account, Home, MembershipStatus, NoShop, ShopPicker, ShopReady, TeamScreen } from './src/screens/shop';
import { NotificationsScreen } from './src/screens/notifications';
import { MaintenanceDetail, MaintenanceScreen } from './src/screens/maintenance';
import { BillingScreen, InvoiceScreen } from './src/screens/billing';
import { SupportScreen } from './src/screens/support';
import { listenForPush, registerPush, unregisterPush, type PushTarget } from './src/push';

type Next =
  | { kind: 'register'; shopName: string; idempotencyKey: string }
  | { kind: 'signin' } | { kind: 'reset' }
  | { kind: 'join'; token: string; shopName: string; displayName: string };
type Route =
  | { screen: 'about'; back: Route }
  | { screen: 'unlock' } | { screen: 'boot' } | { screen: 'welcome' } | { screen: 'register' } | { screen: 'signin'; join?: { token: string; shopName: string } } | { screen: 'reset' }
  | { screen: 'setPassword'; next: Next } | { screen: 'changePassword' }
  | { screen: 'joinEntry' } | { screen: 'joinPreview'; token: string }
  | { screen: 'joinPhone'; token: string; shopName: string } | { screen: 'joinName'; token: string; shopName: string }
  | { screen: 'otp'; phone: string; challenge: Challenge; next: Next; back: Route }
  | { screen: 'shopReady'; shopName: string; link: JoinLink | null }
  | { screen: 'shop' } | { screen: 'shops' } | { screen: 'team' } | { screen: 'account' } | { screen: 'notifications' } | { screen: 'offline' }
  | { screen: 'customers' } | { screen: 'customer'; id: string } | { screen: 'customerNew'; search: string; then?: 'jobNew' | 'serviceAdhoc' }
  | { screen: 'locationNew'; customerId: string } | { screen: 'locationEdit'; customerId: string; location: CustomerLocation }
  | { screen: 'equipmentNew'; customerId: string; locationId: string; returnTo?: Route } | { screen: 'equipment'; customerId: string; id: string }
  | { screen: 'service'; job: Job } | { screen: 'serviceAdhoc'; customerId: string; locationId: string } | { screen: 'adhocPick' }
  | { screen: 'serviceDone'; result: ServiceResult; back: Route } | { screen: 'maintenance' } | { screen: 'maintenanceItem'; item: MaintenanceItem } | { screen: 'billing' } | { screen: 'invoice'; id: string } | { screen: 'support' }
  | { screen: 'jobs' } | { screen: 'job'; id: string; conflicts?: number } | { screen: 'jobPick' } | { screen: 'jobNew'; customerId: string; locationId: string };

// The native splash is hidden only once the start screen below has drawn, so there is no blank frame.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

export default function App() {
  const [fontsLoaded] = useFonts({ NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold });
  const [language, setLanguage] = useState<Language>('th');
  const [route, setRoute] = useState<Route>({ screen: 'boot' });
  // The start screen stays at least this long so the brand is seen, not flashed.
  const [shownLongEnough, setShownLongEnough] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setShownLongEnough(true), 1200); return () => clearTimeout(timer); }, []);
  const [me, setMe] = useState<Me | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const pendingToken = useRef<string | null>(null);
  const [pushTarget, setPushTarget] = useState<PushTarget | null>(null);

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
    setRoute(current => ['boot', 'unlock'].includes(current.screen) ? (pendingToken.current = token, current) : { screen: 'joinPreview', token });
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
        if (await storage.get(keys.biometric) === 'true') { setRoute({ screen: 'unlock' }); return; }
        try { const loaded = await loadMe(); next = loaded.user.password_set ? { screen: 'shop' } : { screen: 'setPassword', next: { kind: 'signin' } }; if (loaded.user.preferred_language !== initial) { setLanguage(loaded.user.preferred_language); api.language = loaded.user.preferred_language; } }
        // Still signed in but the service is unreachable: offer a retry instead of the welcome page.
        catch { next = api.signedIn ? { screen: 'offline' } : { screen: 'welcome' }; }
      }
      const token = pendingToken.current; pendingToken.current = null;
      setRoute(token ? { screen: 'joinPreview', token } : next);
    })();
    const stopPush = listenForPush(setPushTarget);
    return () => { subscription.remove(); stopPush(); };
  }, []);

  // Register this phone for push once signed in (a pending technician's first push is the approval).
  const pushUser = me?.user.id ?? null;
  useEffect(() => { if (pushUser) void registerPush(language); }, [pushUser]);

  // A tapped push reloads memberships (it may be the approval) and opens that shop's inbox; the
  // inbox re-checks access before opening anything.
  useEffect(() => {
    if (!pushTarget || !me) return;
    setPushTarget(null);
    void loadMe(pushTarget.organizationId).then(next => {
      const target = next.memberships.find(m => m.organization_id === pushTarget.organizationId);
      setRoute({ screen: target?.status === 'active' ? 'notifications' : 'shop' });
    }).catch(() => {});
  }, [pushTarget, me, loadMe]);

  async function changeLanguage(value: Language) {
    setLanguage(value); api.language = value;
    await storage.set(keys.language, value);
    if (api.signedIn) { try { setMe(await api.updateMe({ preferred_language: value })); } catch { /* kept locally */ } }
  }

  // An SMS code proves the phone; a new account (or a forgotten password) then sets a password,
  // so later sign-ins need no SMS.
  async function afterVerify(next: Next, challengeId: string, code: string) {
    const displayName = next.kind === 'join' ? next.displayName : undefined;
    const verified = await api.verifyOtp(challengeId, code, displayName);
    if (next.kind === 'reset' || !verified.password_set) setRoute({ screen: 'setPassword', next });
    else await continueAfterSignIn(next);
  }

  async function continueAfterSignIn(next: Next) {
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

  async function signOut() { await unregisterPush(); await api.signOut(); await storage.set(keys.organization, null); signedOut(); }

  const membership = me?.memberships.find(m => m.organization_id === organizationId);
  const several = (me?.memberships.length ?? 0) > 1;
  /** After adding (or picking an existing) customer from a job/ad-hoc picker: continue that flow
   * when there is one place, otherwise open the customer to choose a place there. */
  function continueWithCustomer(then: 'jobNew' | 'serviceAdhoc' | undefined, customer: Customer) {
    const only = customer.locations.length === 1 ? customer.locations[0]! : null;
    setRoute(then && only ? { screen: then, customerId: customer.id, locationId: only.id } : { screen: 'customer', id: customer.id });
  }
  let content;
  switch (route.screen) {
    case 'unlock': content = <Unlock onUnlock={async () => {
      try { const loaded = await loadMe(); const token = pendingToken.current; pendingToken.current = null;
        setRoute(token ? { screen: 'joinPreview', token } : loaded.user.password_set ? { screen: 'shop' } : { screen: 'setPassword', next: { kind: 'signin' } });
      } catch (e) { if (api.signedIn) setRoute({ screen: 'offline' }); else setRoute({ screen: 'welcome' }); }
    }} onPassword={async () => { await signOut(); setRoute({ screen: 'signin' }); }} />; break;
    case 'about': content = <About onBack={() => setRoute(route.back)} />; break;
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
    case 'signin': {
      const join = route.join;
      content = <PasswordSignIn subtitle={join?.shopName} onBack={() => setRoute(join ? { screen: 'joinPreview', token: join.token } : { screen: 'welcome' })}
        onForgot={() => setRoute({ screen: 'reset' })} onAbout={() => setRoute({ screen: 'about', back: route })}
        onSignedIn={async () => {
          const loaded = await loadMe();
          if (!loaded.user.password_set) setRoute({ screen: 'setPassword', next: { kind: 'signin' } });
          else setRoute(join ? { screen: 'joinName', token: join.token, shopName: join.shopName } : { screen: 'shop' });
        }} />;
      break;
    }
    case 'reset': content = <PhoneForm mode="reset" onBack={() => setRoute({ screen: 'signin' })}
      onCodeSent={(phone, challenge) => setRoute({ screen: 'otp', phone, challenge, back: route, next: { kind: 'reset' } })} />; break;
    case 'setPassword': {
      const next = route.next;
      content = <PasswordSetup step={next.kind === 'register' || next.kind === 'join' ? 3 : undefined}
        onDone={() => continueAfterSignIn(next.kind === 'reset' ? { kind: 'signin' } : next)} />;
      break;
    }
    case 'changePassword': content = <PasswordSetup requireCurrent onBack={() => setRoute({ screen: 'account' })}
      onDone={async () => { setRoute({ screen: 'account' }); }} />; break;
    case 'joinEntry': content = <JoinEntry onBack={() => setRoute(api.signedIn ? { screen: 'shop' } : { screen: 'welcome' })} onToken={token => setRoute({ screen: 'joinPreview', token })} />; break;
    case 'joinPreview': content = <JoinPreview token={route.token} onBack={() => setRoute(api.signedIn ? { screen: 'shop' } : { screen: 'welcome' })}
      signedInPhone={api.signedIn ? me?.user.phone_e164 : undefined}
      onUseAnotherPhone={async () => { await signOut(); setRoute({ screen: 'joinPreview', token: route.token }); }}
      onContinue={shopName => setRoute(api.signedIn ? { screen: 'joinName', token: route.token, shopName } : { screen: 'joinPhone', token: route.token, shopName })}
      onSignIn={shopName => setRoute({ screen: 'signin', join: { token: route.token, shopName } })} />; break;
    case 'joinPhone': content = <PhoneForm mode="join" shopPreview={route.shopName} onBack={() => setRoute({ screen: 'joinPreview', token: route.token })}
      onCodeSent={(phone, challenge, name) => setRoute({ screen: 'otp', phone, challenge, back: route, next: { kind: 'join', token: route.token, shopName: route.shopName, displayName: name } })} />; break;
    case 'joinName': content = <JoinName shopName={route.shopName} initialName={me?.user.display_name ?? ''} onBack={() => setRoute({ screen: 'joinPreview', token: route.token })}
      onSubmit={async name => { const joined = await api.requestJoin(route.token, name); await loadMe(joined.organization_id); setRoute({ screen: 'shop' }); }} />; break;
    case 'otp': content = <OtpForm phone={route.phone} challenge={route.challenge} onBack={() => setRoute(route.back)}
      step={route.next.kind === 'register' || route.next.kind === 'join' ? 2 : undefined}
      onVerify={(id, code) => afterVerify(route.next, id, code)} />; break;
    case 'shopReady': content = <ShopReady shopName={route.shopName} link={route.link} onDone={() => setRoute({ screen: 'shop' })} />; break;
    case 'notifications': content = membership?.status === 'active'
      ? <NotificationsScreen membership={membership} onBack={() => setRoute({ screen: 'shop' })}
        onOpen={item => setRoute(item.target_type === 'job' && item.target_id ? { screen: 'job', id: item.target_id }
          : item.target_type === 'maintenance_cycle' && membership.role === 'owner' ? { screen: 'maintenance' }
          : item.target_type === 'invoice' && item.target_id && membership.role === 'owner' ? { screen: 'invoice', id: item.target_id }
          : (item.target_type === 'support_ticket' || item.target_type === 'support_grant') && membership.role === 'owner' ? { screen: 'support' }
          : { screen: item.template_key === 'join_request' && membership.role === 'owner' ? 'team' : 'shop' })} /> : <Loading />; break;
    case 'customer': content = membership?.status === 'active'
      ? <CustomerDetail key={route.id} membership={membership} customerId={route.id} onBack={() => setRoute({ screen: 'customers' })}
        onAddLocation={() => setRoute({ screen: 'locationNew', customerId: route.id })}
        onEditLocation={location => setRoute({ screen: 'locationEdit', customerId: route.id, location })}
        onAddEquipment={locationId => setRoute({ screen: 'equipmentNew', customerId: route.id, locationId })}
        onOpenEquipment={id => setRoute({ screen: 'equipment', customerId: route.id, id })}
        onCreateJob={locationId => setRoute({ screen: 'jobNew', customerId: route.id, locationId })} /> : <Loading />; break;
    case 'jobPick': content = membership?.status === 'active'
      ? <JobCustomerPicker membership={membership} onBack={() => setRoute({ screen: 'jobs' })} onPicked={(customerId, locationId) => setRoute({ screen: 'jobNew', customerId, locationId })}
        onCreate={search => setRoute({ screen: 'customerNew', search, then: 'jobNew' })} /> : <Loading />; break;
    case 'jobNew': content = membership?.status === 'active'
      ? <JobForm membership={membership} me={{ memberId: membership.member_id }} customerId={route.customerId} locationId={route.locationId}
        onBack={() => setRoute({ screen: 'customer', id: route.customerId })} onCreated={(id, conflicts) => setRoute({ screen: 'job', id, conflicts })} /> : <Loading />; break;
    case 'job': content = membership?.status === 'active'
      ? <JobDetail key={route.id} membership={membership} jobId={route.id} conflicts={route.conflicts}
        onBack={() => setRoute({ screen: membership.role === 'owner' ? 'jobs' : 'shop' })} onOpenCustomer={id => setRoute({ screen: 'customer', id })}
        onRecordService={job => setRoute({ screen: 'service', job })} /> : <Loading />; break;
    case 'equipmentNew': content = membership?.status === 'active'
      ? <EquipmentForm membership={membership} locationId={route.locationId} onBack={() => setRoute(route.returnTo ?? { screen: 'customer', id: route.customerId })}
        onDone={() => setRoute(route.returnTo ?? { screen: 'customer', id: route.customerId })} onOpenExisting={id => setRoute({ screen: 'equipment', customerId: route.customerId, id })} /> : <Loading />; break;
    case 'service': case 'serviceAdhoc': content = membership?.status === 'active'
      ? <ServiceForm key={route.screen === 'service' ? route.job.id : route.locationId} membership={membership}
        job={route.screen === 'service' ? route.job : undefined} adhoc={route.screen === 'serviceAdhoc' ? { customerId: route.customerId, locationId: route.locationId } : undefined}
        onBack={() => setRoute(route.screen === 'service' ? { screen: 'job', id: route.job.id } : { screen: 'shop' })}
        onAddEquipment={locationId => setRoute({ screen: 'equipmentNew', customerId: route.screen === 'service' ? route.job.customer_id : route.customerId, locationId, returnTo: route })}
        onDone={result => setRoute({ screen: 'serviceDone', result, back: route.screen === 'service' ? { screen: 'job', id: route.job.id } : { screen: 'shop' } })} /> : <Loading />; break;
    case 'maintenance': content = membership?.status === 'active' && membership.role === 'owner'
      ? <MaintenanceScreen membership={membership} onBack={() => setRoute({ screen: 'shop' })} onOpen={item => setRoute({ screen: 'maintenanceItem', item })} /> : <Loading />; break;
    case 'maintenanceItem': content = membership?.status === 'active' && membership.role === 'owner'
      ? <MaintenanceDetail key={route.item.id} membership={membership} item={route.item} onBack={() => setRoute({ screen: 'maintenance' })}
        onOpenJob={id => setRoute({ screen: 'job', id })} onOpenCustomer={id => setRoute({ screen: 'customer', id })} /> : <Loading />; break;
    case 'billing': content = membership?.status === 'active' && membership.role === 'owner'
      ? <BillingScreen membership={membership} onBack={() => setRoute({ screen: 'shop' })} onOpenInvoice={id => setRoute({ screen: 'invoice', id })} /> : <Loading />; break;
    case 'invoice': content = membership?.status === 'active' && membership.role === 'owner'
      ? <InvoiceScreen key={route.id} membership={membership} invoiceId={route.id} onBack={() => setRoute({ screen: 'billing' })} /> : <Loading />; break;
    case 'support': content = membership?.status === 'active' && membership.role === 'owner'
      ? <SupportScreen membership={membership} onBack={() => setRoute({ screen: membership.organization_status === 'active' ? 'account' : 'shop' })} /> : <Loading />; break;
    case 'serviceDone': content = <ServiceDone result={route.result} onDone={() => setRoute(route.back)} />; break;
    case 'adhocPick': content = membership?.status === 'active'
      ? <JobCustomerPicker membership={membership} onBack={() => setRoute({ screen: 'shop' })} onPicked={(customerId, locationId) => setRoute({ screen: 'serviceAdhoc', customerId, locationId })}
        onCreate={search => setRoute({ screen: 'customerNew', search, then: 'serviceAdhoc' })} /> : <Loading />; break;
    case 'equipment': content = membership?.status === 'active'
      ? <EquipmentDetail key={route.id} membership={membership} equipmentId={route.id} onBack={() => setRoute({ screen: 'customer', id: route.customerId })} /> : <Loading />; break;
    case 'customerNew': content = membership?.status === 'active'
      ? <CustomerForm membership={membership} initialSearch={route.search}
        onBack={() => setRoute(route.then === 'jobNew' ? { screen: 'jobPick' } : route.then === 'serviceAdhoc' ? { screen: 'adhocPick' } : { screen: 'customers' })}
        onSaved={c => continueWithCustomer(route.then, c)}
        onOpenExisting={id => { if (route.then) void api.customer(membership.organization_id, id).then(c => continueWithCustomer(route.then, c), () => setRoute({ screen: 'customer', id })); else setRoute({ screen: 'customer', id }); }} /> : <Loading />; break;
    case 'locationNew': case 'locationEdit': content = membership?.status === 'active'
      ? <LocationForm membership={membership} customerId={route.customerId} location={route.screen === 'locationEdit' ? route.location : undefined}
        onBack={() => setRoute({ screen: 'customer', id: route.customerId })} onSaved={() => setRoute({ screen: 'customer', id: route.customerId })} /> : <Loading />; break;
    case 'shops': content = me ? <ShopPicker me={me} onBack={() => setRoute({ screen: 'shop' })} onCreate={() => setRoute({ screen: 'register' })}
      onJoin={() => setRoute({ screen: 'joinEntry' })} onPick={async id => { await selectOrganization(id); setRoute({ screen: 'shop' }); }} /> : <Loading />; break;
    case 'shop': case 'team': case 'account': case 'customers': case 'jobs': {
      if (!me) { content = <Loading />; break; }
      const suspended = membership?.status === 'active' && membership.organization_status === 'suspended';
      const active = membership?.status === 'active' && !suspended;
      // Tabs only for an active membership; pending/suspended/no shop never show business menus.
      if (route.screen === 'shop' && !membership) content = <NoShop onCreate={() => setRoute({ screen: 'register' })} onJoin={() => setRoute({ screen: 'joinEntry' })} />;
      else if (route.screen === 'shop' && membership && suspended) content = <Screen>
        <Banner text={translate(language, 'ORGANIZATION_SUSPENDED')} />
        {membership.role === 'owner' ? <Button icon="help-buoy" title={translate(language, 'support')} onPress={() => setRoute({ screen: 'support' })} /> : null}
        {several ? <Button kind="secondary" title={translate(language, 'myShops')} onPress={() => setRoute({ screen: 'shops' })} /> : null}
        <Button kind="danger" icon="log-out-outline" title={translate(language, 'signOut')} onPress={signOut} />
      </Screen>;
      else if (route.screen === 'shop' && membership && !active) content = <MembershipStatus membership={membership} onCheck={async () => { await loadMe(membership.organization_id); }}
        onSwitch={several ? () => setRoute({ screen: 'shops' }) : undefined} onSignOut={signOut} />;
      else if (route.screen === 'team' && membership?.role === 'owner' && active) content = <TeamScreen membership={membership} />;
      else if (route.screen === 'jobs' && membership?.role === 'owner' && active) content = <JobsScreen membership={membership}
        onOpen={id => setRoute({ screen: 'job', id })} onCreate={() => setRoute({ screen: 'jobPick' })} />;
      else if (route.screen === 'customers' && membership && active) content = <CustomersScreen membership={membership}
        onOpen={id => setRoute({ screen: 'customer', id })} onCreate={search => setRoute({ screen: 'customerNew', search })} />;
      else if (route.screen === 'account') content = <Account me={me} language={language} onLanguage={changeLanguage} onSignOut={signOut}
        onChangePassword={() => setRoute({ screen: 'changePassword' })} onAbout={() => setRoute({ screen: 'about', back: { screen: 'account' } })}
        onSwitch={several || !membership ? () => setRoute({ screen: 'shops' }) : undefined} onBack={active ? undefined : () => setRoute({ screen: 'shop' })}
        onSupport={membership?.role === 'owner' && membership.status === 'active' ? () => setRoute({ screen: 'support' }) : undefined} />;
      else if (membership && active) content = <Home me={me} membership={membership} onTeam={() => setRoute({ screen: 'team' })} onNotifications={() => setRoute({ screen: 'notifications' })} onOpenJob={id => setRoute({ screen: 'job', id })} onRecordAdhoc={() => setRoute({ screen: 'adhocPick' })} onMaintenance={() => setRoute({ screen: 'maintenance' })} onBilling={() => setRoute({ screen: 'billing' })} />;
      else content = <Loading />;
      if (membership && active) {
        const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
        const tabs = [
          { key: 'shop' as const, label: membership.role === 'owner' ? tr('home') : tr('today'), icon: 'home' as const },
          ...(membership.role === 'owner' ? [{ key: 'jobs' as const, label: tr('jobs'), icon: 'briefcase' as const }] : []),
          { key: 'customers' as const, label: tr('customers'), icon: 'person' as const },
          ...(membership.role === 'owner' ? [{ key: 'team' as const, label: tr('team'), icon: 'people' as const }] : []),
          { key: 'account' as const, label: tr('account'), icon: 'person-circle' as const },
        ];
        content = <View style={styles.root}><View style={styles.root}>{content}</View><TabBar tabs={tabs} active={route.screen} onChange={screen => setRoute({ screen })} /></View>;
      }
      break;
    }
  }
  // Native splash (emblem) → this start screen (emblem + KooChang / คู่ช่าง) → the app.
  if (!fontsLoaded || route.screen === 'boot' || !shownLongEnough) return <LanguageContext.Provider value={language}><BrandStart /></LanguageContext.Provider>;
  return <LanguageContext.Provider value={language}>
    <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}><StatusBar barStyle="dark-content" backgroundColor={colors.bg} />{content}</SafeAreaView></SafeAreaProvider>
  </LanguageContext.Provider>;
}

/** Start screen on the brand navy, drawn responsively from the selected lockup (branding/koochang). */
function BrandStart() {
  return <View style={startStyles.root} onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }}>
    <StatusBar barStyle="light-content" backgroundColor={brandNavy} />
    <Image source={require('./assets/splash-lockup.png')} style={startStyles.lockup} resizeMode="contain" accessibilityLabel="KooChang คู่ช่าง" />
  </View>;
}
const brandNavy = '#12243A';
const startStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandNavy, alignItems: 'center', justifyContent: 'center' },
  lockup: { width: '58%', maxWidth: 260, aspectRatio: 576 / 605 },
});

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
