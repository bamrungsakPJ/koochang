import { useCallback, useEffect, useState } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { formatPhone, type Language } from '@field-service/core';
import { api, ApiFailure, type JoinLink, type Me, type Membership, type Team, type TeamMember } from '../api';
import { Badge, Banner, Button, colors, confirm, Loading, Panel, Screen, Section, Sub, Title, useErrorText, useT } from '../ui';
import { LanguageSwitch } from './onboarding';

function JoinLinkPanel({ link, shopName, onChange }: { link: JoinLink; shopName: string; onChange?: (action: 'open' | 'close' | 'rotate') => Promise<void> }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  async function run(action: 'open' | 'close' | 'rotate') {
    if (!onChange) return;
    if (action === 'rotate' && !await confirm(t('resetConfirm'), t('resetLink'), t('cancel'))) return;
    setBusy(action);
    try { await onChange(action); } finally { setBusy(null); }
  }
  return <Panel>
    <Text style={styles.panelLabel}>{t('joinLink')}</Text>
    <Text selectable style={styles.link}>{link.url}</Text>
    {link.status === 'closed' ? <Banner tone="info" text={t('joiningClosed')} /> : null}
    <Button title={t('share')} kind="secondary" onPress={() => { void Share.share({ message: t('shareMessage', { shop: shopName, url: link.url }) }); }} />
    <Button title={qr ? t('hideQr') : t('showQr')} kind="secondary" onPress={() => setQr(!qr)} />
    {qr ? <View style={styles.qrBox}><Image source={{ uri: link.qr_png }} style={styles.qr} accessibilityLabel={t('qrHint')} /><Sub center>{t('qrHint')}</Sub></View> : null}
    {onChange ? <>
      <Button title={link.status === 'active' ? t('closeJoining') : t('openJoining')} kind="link" busy={busy === 'open' || busy === 'close'}
        onPress={() => run(link.status === 'active' ? 'close' : 'open')} />
      <Button title={t('resetLink')} kind="danger" busy={busy === 'rotate'} onPress={() => run('rotate')} />
    </> : null}
  </Panel>;
}

export function ShopReady({ shopName, link, onDone }: { shopName: string; link: JoinLink | null; onDone: () => void }) {
  const t = useT();
  return <Screen>
    <View style={styles.successMark}><Text style={styles.successTick}>✓</Text></View>
    <Title>{t('shopReadyTitle')}</Title>
    <Sub>{shopName}</Sub>
    <Sub>{t('shopReadyBody')}</Sub>
    {link ? <JoinLinkPanel link={link} shopName={shopName} /> : null}
    <Button title={t('goToShop')} onPress={onDone} />
  </Screen>;
}

/** Pending, rejected or suspended: no business menus, only the state and how to continue. */
export function MembershipStatus({ membership, onCheck, onSwitch, onSignOut }: { membership: Membership; onCheck: () => Promise<void>; onSwitch?: () => void; onSignOut: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const shop = membership.organization_name ?? '';
  const body = membership.status === 'pending' ? t('pendingBody', { shop }) : membership.status === 'suspended' ? t('suspendedBody', { shop }) : t('rejectedBody', { shop });
  return <Screen>
    <View style={styles.successMark}><Text style={styles.successTick}>{membership.status === 'pending' ? '…' : '!'}</Text></View>
    <Title>{membership.status === 'pending' ? t('pendingTitle') : t(`member.${membership.status}`)}</Title>
    <Sub>{membership.display_name}{shop ? ` · ${shop}` : ''}</Sub>
    <Panel><Sub>{body}</Sub></Panel>
    <Button title={t('checkStatus')} kind="secondary" busy={busy} onPress={async () => { setBusy(true); try { await onCheck(); } finally { setBusy(false); } }} />
    {onSwitch ? <Button title={t('switchShop')} kind="link" onPress={onSwitch} /> : null}
    <Button title={t('signOut')} kind="link" onPress={onSignOut} />
  </Screen>;
}

export function NoShop({ onCreate, onJoin, onAccount }: { onCreate: () => void; onJoin: () => void; onAccount: () => void }) {
  const t = useT();
  return <Screen>
    <Title>{t('noShopYet')}</Title>
    <Button title={t('createShop')} onPress={onCreate} />
    <Button title={t('joinShop')} kind="secondary" onPress={onJoin} />
    <Button title={t('account')} kind="link" onPress={onAccount} />
  </Screen>;
}

export function Home({ me, membership, onTeam, onAccount, onSwitch }: { me: Me; membership: Membership; onTeam: () => void; onAccount: () => void; onSwitch?: () => void }) {
  const t = useT();
  const owner = membership.role === 'owner';
  return <Screen>
    <Text style={styles.shopLine}>{membership.organization_name}</Text>
    <Title>{owner ? t('home') : t('today')}</Title>
    <Sub>{me.user.display_name} · {t(`role.${membership.role}`)}</Sub>
    {owner ? <Panel>
      <Text style={styles.panelTitle}>{t('team')}</Text>
      <Sub>{t('shopReadyBody')}</Sub>
      <Button title={t('team')} kind="secondary" onPress={onTeam} />
    </Panel> : null}
    <Panel><Sub>{t('notBuiltYet')}</Sub></Panel>
    {onSwitch ? <Button title={t('switchShop')} kind="link" onPress={onSwitch} /> : null}
    <Button title={t('account')} kind="link" onPress={onAccount} />
  </Screen>;
}

export function ShopPicker({ me, onPick, onCreate, onJoin, onBack }: { me: Me; onPick: (organizationId: string) => void; onCreate: () => void; onJoin: () => void; onBack: () => void }) {
  const t = useT();
  return <Screen onBack={onBack}>
    <Title>{t('myShops')}</Title>
    {me.memberships.map(m => <Panel key={m.member_id}>
      <Text style={styles.panelTitle}>{m.organization_name ?? '—'}</Text>
      <View style={styles.row}><Badge text={t(`role.${m.role}`)} /><Badge text={t(`member.${m.status}`)} tone={m.status === 'active' ? 'ok' : m.status === 'pending' ? 'warn' : 'danger'} /></View>
      <Button title={t('goToShop')} kind="secondary" onPress={() => onPick(m.organization_id)} />
    </Panel>)}
    <Button title={t('createShop')} kind="link" onPress={onCreate} />
    <Button title={t('joinShop')} kind="link" onPress={onJoin} />
  </Screen>;
}

export function Account({ me, language, onLanguage, onSignOut, onBack }: { me: Me; language: Language; onLanguage: (value: Language) => void; onSignOut: () => void; onBack: () => void }) {
  const t = useT();
  return <Screen onBack={onBack}>
    <Title>{t('account')}</Title>
    <Panel><Text style={styles.panelTitle}>{me.user.display_name}</Text><Sub>{formatPhone(me.user.phone_e164)}</Sub></Panel>
    <Section>{t('language')}</Section>
    <LanguageSwitch language={language} onChange={onLanguage} />
    <Button title={t('signOut')} kind="danger" onPress={onSignOut} />
  </Screen>;
}

/** Owner team screen: join link, pending requests, members and seat usage. */
export function TeamScreen({ membership, onBack }: { membership: Membership; onBack: () => void }) {
  const t = useT();
  const errorText = useErrorText();
  const organizationId = membership.organization_id;
  const [team, setTeam] = useState<Team | null>(null);
  const [link, setLink] = useState<JoinLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const [nextTeam, nextLink] = await Promise.all([api.team(organizationId), api.joinLink(organizationId)]); setTeam(nextTeam); setLink(nextLink); }
    catch (failure) { setError(errorText(failure)); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  async function act(member: TeamMember, action: 'approve' | 'reject' | 'suspend' | 'reactivate' | 'remove') {
    if (action === 'remove' && !await confirm(t('removeConfirm', { name: member.display_name }), t('remove'), t('cancel'))) return;
    if (action === 'suspend' && !await confirm(t('suspendConfirm', { name: member.display_name }), t('suspend'), t('cancel'))) return;
    setBusy(`${member.member_id}:${action}`); setError(null); setNotice(null);
    try {
      const result = await api.changeMember(organizationId, member.member_id, action, member.version) as { open_jobs?: number };
      if ((action === 'suspend' || action === 'remove') && result.open_jobs) setNotice(t('openJobsWarning', { count: result.open_jobs }));
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(null); await load(); }
  }
  async function changeLink(action: 'open' | 'close' | 'rotate') {
    setError(null);
    try { setLink(await api.changeJoinLink(organizationId, action)); } catch (failure) { setError(errorText(failure)); }
  }

  if (!team || !link) return error ? <Screen onBack={onBack}><Banner text={error} /><Button title={t('retry')} onPress={load} /></Screen> : <Loading />;
  const technicians = team.members.filter(m => m.role === 'technician');
  const pending = technicians.filter(m => m.status === 'pending');
  const others = technicians.filter(m => m.status !== 'pending');
  const full = team.seats.active_technicians >= team.seats.seat_limit;
  return <Screen onBack={onBack}>
    <Title>{t('team')}</Title>
    <Sub>{t('seatUsage', { active: team.seats.active_technicians, limit: team.seats.seat_limit })}</Sub>
    <Banner text={error} />
    <Banner tone="info" text={notice} />
    <JoinLinkPanel link={link} shopName={membership.organization_name ?? ''} onChange={changeLink} />

    <Section>{t('pendingRequests')}</Section>
    {pending.length === 0 ? <Sub>{t('noPending')}</Sub> : pending.map(m => <Panel key={m.member_id}>
      <Text style={styles.panelTitle}>{m.display_name}</Text>
      {m.phone_e164 ? <Sub>{formatPhone(m.phone_e164)}</Sub> : null}
      {full ? <Banner tone="info" text={t('SEAT_LIMIT_REACHED')} /> : null}
      <View style={styles.actions}>
        <View style={styles.action}><Button title={t('approve')} disabled={full} busy={busy === `${m.member_id}:approve`} onPress={() => act(m, 'approve')} /></View>
        <View style={styles.action}><Button title={t('reject')} kind="secondary" busy={busy === `${m.member_id}:reject`} onPress={() => act(m, 'reject')} /></View>
      </View>
    </Panel>)}

    <Section>{t('members')}</Section>
    {others.map(m => <Panel key={m.member_id}>
      <Text style={styles.panelTitle}>{m.display_name}</Text>
      <Badge text={t(`member.${m.status}`)} tone={m.status === 'active' ? 'ok' : m.status === 'suspended' ? 'danger' : 'neutral'} />
      {m.open_jobs > 0 ? <Sub>{t('openJobsWarning', { count: m.open_jobs })}</Sub> : null}
      <View style={styles.actions}>
        {m.status === 'active' ? <View style={styles.action}><Button title={t('suspend')} kind="secondary" busy={busy === `${m.member_id}:suspend`} onPress={() => act(m, 'suspend')} /></View> : null}
        {m.status === 'suspended' ? <View style={styles.action}><Button title={t('reactivate')} kind="secondary" disabled={full} busy={busy === `${m.member_id}:reactivate`} onPress={() => act(m, 'reactivate')} /></View> : null}
        <View style={styles.action}><Button title={t('remove')} kind="danger" busy={busy === `${m.member_id}:remove`} onPress={() => act(m, 'remove')} /></View>
      </View>
    </Panel>)}
  </Screen>;
}

export function isAuthFailure(error: unknown) { return error instanceof ApiFailure && error.status === 401; }

const styles = StyleSheet.create({
  panelLabel: { fontSize: 13, color: colors.muted },
  panelTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  link: { fontSize: 15, color: colors.ink, marginTop: 6 },
  qrBox: { alignItems: 'center', marginTop: 12 },
  qr: { width: 220, height: 220 },
  successMark: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center', marginBottom: 16, marginTop: 24 },
  successTick: { fontSize: 30, color: colors.limeInk, fontWeight: '700' },
  shopLine: { fontSize: 15, fontWeight: '600', color: colors.accent },
  row: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 120 },
});
