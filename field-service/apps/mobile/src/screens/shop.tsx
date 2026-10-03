import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { formatPhone, type Language } from '@field-service/core';
import { api, type JoinLink, type Me, type Membership, type Team, type TeamMember } from '../api';
import { Avatar, Badge, Banner, Button, Card, colors, confirm, fonts, Icon, IconButton, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT, type IconName } from '../ui';
import { LanguageSwitch } from './onboarding';

const statusTone = (status: string) => status === 'active' ? 'ok' : status === 'pending' ? 'warn' : status === 'suspended' ? 'danger' : 'neutral';

function JoinLinkCard({ link, shopName, onChange }: { link: JoinLink; shopName: string; onChange?: (action: 'open' | 'close' | 'rotate') => Promise<void> }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const share = () => { void Share.share({ message: t('shareMessage', { shop: shopName, url: link.url }) }); };
  async function run(action: 'open' | 'close' | 'rotate') {
    if (!onChange) return;
    if (action === 'rotate' && !await confirm(t('resetConfirm'), t('resetLink'), t('cancel'))) return;
    setBusy(action);
    try { await onChange(action); } finally { setBusy(null); }
  }
  return <Card>
    <View style={styles.linkHead}>
      <View style={{ flex: 1 }}><Strong>{t('joinLink')}</Strong><Sub>{t('joinLinkHint')}</Sub></View>
      <Badge text={link.status === 'active' ? t('joiningOpen') : t('joiningPaused')} tone={link.status === 'active' ? 'ok' : 'neutral'} />
    </View>
    <View style={styles.linkBox}>
      <Icon name="link" size={18} color={colors.muted} />
      <Text selectable numberOfLines={1} style={styles.linkText}>{link.url}</Text>
      <IconButton icon="share-social" label={t('share')} onPress={share} />
      <IconButton icon={qr ? 'close' : 'qr-code'} label={qr ? t('hideQr') : t('showQr')} onPress={() => setQr(!qr)} />
    </View>
    {qr ? <View style={styles.qrBox}><Image source={{ uri: link.qr_png }} style={styles.qr} accessibilityLabel={t('qrHint')} /><Sub center>{t('qrHint')}</Sub></View> : null}
    {link.status === 'closed' ? <Banner tone="info" text={t('joiningClosed')} /> : null}
    {onChange ? <View style={styles.linkActions}>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon={link.status === 'active' ? 'pause' : 'play'} title={link.status === 'active' ? t('closeJoining') : t('openJoining')}
        busy={busy === 'open' || busy === 'close'} onPress={() => run(link.status === 'active' ? 'close' : 'open')} /></View>
      <View style={{ flex: 1 }}><Button small kind="danger" icon="refresh" title={t('resetLink')} busy={busy === 'rotate'} onPress={() => run('rotate')} /></View>
    </View> : null}
  </Card>;
}

function StatusIcon({ icon, tone }: { icon: IconName; tone: 'ok' | 'warn' | 'danger' | 'info' }) {
  const [bg, fg] = { ok: [colors.successSoft, colors.success], warn: [colors.warnSoft, colors.warn], danger: [colors.dangerSoft, colors.danger], info: [colors.primarySoft, colors.primary] }[tone];
  return <View style={[styles.statusIcon, { backgroundColor: bg }]}><Icon name={icon} size={32} color={fg} /></View>;
}

export function ShopReady({ shopName, link, onDone }: { shopName: string; link: JoinLink | null; onDone: () => void }) {
  const t = useT();
  return <Screen footer={<Button title={t('goToShop')} icon="arrow-forward" onPress={onDone} />}>
    <StatusIcon icon="checkmark" tone="ok" />
    <Title>{t('shopReadyTitle')}</Title>
    <Sub>{shopName}</Sub>
    <Sub>{t('shopReadyBody')}</Sub>
    {link ? <JoinLinkCard link={link} shopName={shopName} /> : null}
  </Screen>;
}

/** Pending, rejected or suspended: no business menus, only the state and how to continue. */
export function MembershipStatus({ membership, onCheck, onSwitch, onSignOut }: { membership: Membership; onCheck: () => Promise<void>; onSwitch?: () => void; onSignOut: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const shop = membership.organization_name ?? '';
  const pending = membership.status === 'pending';
  const body = pending ? t('pendingBody', { shop }) : membership.status === 'suspended' ? t('suspendedBody', { shop }) : t('rejectedBody', { shop });
  return <Screen footer={<>
    <Button title={t('checkStatus')} icon="refresh" busy={busy} onPress={async () => { setBusy(true); try { await onCheck(); } finally { setBusy(false); } }} />
    {onSwitch ? <Button title={t('switchShop')} kind="ghost" icon="swap-horizontal" onPress={onSwitch} /> : null}
    <Button title={t('signOut')} kind="ghost" icon="log-out-outline" onPress={onSignOut} />
  </>}>
    <StatusIcon icon={pending ? 'time' : membership.status === 'suspended' ? 'ban' : 'close-circle'} tone={pending ? 'warn' : 'danger'} />
    <Title>{pending ? t('pendingTitle') : t(`member.${membership.status}`)}</Title>
    <Sub>{membership.display_name}{shop ? ` · ${shop}` : ''}</Sub>
    <Card><Sub>{body}</Sub></Card>
  </Screen>;
}

export function NoShop({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const t = useT();
  return <Screen>
    <StatusIcon icon="storefront" tone="info" />
    <Title>{t('noShopYet')}</Title>
    <Card padded={false}>
      <Row icon="add-circle" title={t('createShop')} subtitle={t('createShopHint')} onPress={onCreate} />
      <Row icon="link" title={t('joinShop')} subtitle={t('joinShopHint')} onPress={onJoin} last />
    </Card>
  </Screen>;
}

function Stat({ icon, label, value, tone = colors.primary }: { icon: IconName; label: string; value: string; tone?: string }) {
  return <View style={styles.stat}>
    <Icon name={icon} size={20} color={tone} />
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

export function Home({ me, membership, onTeam }: { me: Me; membership: Membership; onTeam: () => void }) {
  const t = useT();
  const owner = membership.role === 'owner';
  const [team, setTeam] = useState<Team | null>(null);
  useEffect(() => { if (owner) api.team(membership.organization_id).then(setTeam, () => setTeam(null)); }, [owner, membership.organization_id]);
  const pending = team?.members.filter(m => m.status === 'pending').length ?? 0;
  return <Screen>
    <View style={styles.homeHead}>
      <View style={{ flex: 1 }}><Text style={styles.shopLine}>{membership.organization_name}</Text><Title>{owner ? t('shopOverview') : t('today')}</Title></View>
      <Avatar name={me.user.display_name} />
    </View>
    {owner ? <>
      <View style={styles.stats}>
        <Stat icon="people" label={t('activeTechnicians')} value={team ? `${team.seats.active_technicians}/${team.seats.seat_limit}` : '–'} />
        <Stat icon="time" label={t('pendingCount')} value={team ? String(pending) : '–'} tone={pending ? colors.warn : colors.primary} />
      </View>
      {pending ? <Banner tone="info" text={`${t('pendingRequests')}: ${pending}`} /> : null}
      <Card padded={false}><Row icon="people" title={t('manageTeam')} subtitle={t('joinLinkHint')} onPress={onTeam} last /></Card>
    </> : null}
    <Section>{t('comingSoon')}</Section>
    <Card padded={false}>
      <Row icon="briefcase-outline" title={t('jobs')} trailing={<Badge text={t('comingSoon')} />} />
      <Row icon="person-outline" title={t('customers')} trailing={<Badge text={t('comingSoon')} />} />
      <Row icon="hardware-chip-outline" title={t('equipment')} trailing={<Badge text={t('comingSoon')} />} last />
    </Card>
    <Sub>{t('notBuiltYet')}</Sub>
  </Screen>;
}

export function ShopPicker({ me, onPick, onCreate, onJoin, onBack }: { me: Me; onPick: (organizationId: string) => void; onCreate: () => void; onJoin: () => void; onBack: () => void }) {
  const t = useT();
  return <Screen onBack={onBack}>
    <Title>{t('myShops')}</Title>
    <Card padded={false}>
      {me.memberships.map((m, i) => <Row key={m.member_id} icon="storefront" title={m.organization_name ?? '—'}
        subtitle={`${t(`role.${m.role}`)} · ${t(`member.${m.status}`)}`} onPress={() => onPick(m.organization_id)} last={i === me.memberships.length - 1} />)}
    </Card>
    <Card padded={false}>
      <Row icon="add-circle" title={t('createShop')} onPress={onCreate} />
      <Row icon="link" title={t('joinShop')} onPress={onJoin} last />
    </Card>
  </Screen>;
}

export function Account({ me, language, onLanguage, onSignOut, onSwitch, onBack }: {
  me: Me; language: Language; onLanguage: (value: Language) => void; onSignOut: () => void; onSwitch?: () => void; onBack?: () => void;
}) {
  const t = useT();
  return <Screen onBack={onBack}>
    <Title>{t('account')}</Title>
    <Card>
      <View style={styles.profile}><Avatar name={me.user.display_name} size={56} />
        <View style={{ flex: 1 }}><Strong>{me.user.display_name.startsWith('+') ? formatPhone(me.user.display_name) : me.user.display_name}</Strong><Sub>{formatPhone(me.user.phone_e164)}</Sub></View></View>
    </Card>
    <Card padded={false}>
      <Row icon="language" title={t('language')} trailing={<LanguageSwitch language={language} onChange={onLanguage} />} last={!onSwitch} />
      {onSwitch ? <Row icon="swap-horizontal" title={t('myShops')} onPress={onSwitch} last /> : null}
    </Card>
    <Button title={t('signOut')} kind="danger" icon="log-out-outline" onPress={onSignOut} />
  </Screen>;
}

function MemberRow({ member, actions, last }: { member: TeamMember; actions: ReactNode; last?: boolean }) {
  const t = useT();
  return <View style={[styles.member, !last && styles.memberLine]}>
    <View style={styles.memberHead}>
      <Avatar name={member.display_name} />
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>{member.display_name}</Text>
        {member.phone_e164 ? <Text style={styles.memberPhone}>{formatPhone(member.phone_e164)}</Text> : null}
      </View>
      <Badge text={t(`member.${member.status}`)} tone={statusTone(member.status)} />
    </View>
    {member.open_jobs > 0 ? <Banner tone="info" text={t('openJobsWarning', { count: member.open_jobs })} /> : null}
    <View style={styles.memberActions}>{actions}</View>
  </View>;
}

/** Owner team screen: join link, seat usage, pending requests and members. */
export function TeamScreen({ membership }: { membership: Membership }) {
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

  if (!team || !link) return error ? <Screen><Banner text={error} /><Button title={t('retry')} icon="refresh" onPress={load} /></Screen> : <Loading />;
  const technicians = team.members.filter(m => m.role === 'technician');
  const pending = technicians.filter(m => m.status === 'pending');
  const others = technicians.filter(m => m.status !== 'pending');
  const { active_technicians: active, seat_limit: limit } = team.seats;
  const full = active >= limit;
  const small = (m: TeamMember, action: Parameters<typeof act>[1], kind: 'primary' | 'secondary' | 'danger', icon: IconName, disabled = false) =>
    <View style={{ flex: 1 }}><Button small kind={kind} icon={icon} title={t(action)} disabled={disabled} busy={busy === `${m.member_id}:${action}`} onPress={() => act(m, action)} /></View>;

  return <Screen>
    <Title>{t('team')}</Title>
    <View style={styles.seatRow}><Sub>{t('seatUsage', { active, limit })}</Sub></View>
    <View style={styles.seatBar}><View style={[styles.seatFill, { width: `${Math.min(100, (active / limit) * 100)}%` }, full && { backgroundColor: colors.warn }]} /></View>
    <Banner text={error} />
    <Banner tone="info" text={notice} />
    <JoinLinkCard link={link} shopName={membership.organization_name ?? ''} onChange={changeLink} />

    <Section action={pending.length ? <Badge text={String(pending.length)} tone="warn" /> : undefined}>{t('pendingRequests')}</Section>
    {full && pending.length ? <Banner tone="info" text={t('SEAT_LIMIT_REACHED')} /> : null}
    <Card padded={false}>
      {pending.length === 0 ? <Row icon="mail-open-outline" title={t('noPending')} last />
        : pending.map((m, i) => <MemberRow key={m.member_id} member={m} last={i === pending.length - 1}
          actions={<>{small(m, 'approve', 'primary', 'checkmark', full)}{small(m, 'reject', 'secondary', 'close')}</>} />)}
    </Card>

    {others.length ? <>
      <Section>{t('members')}</Section>
      <Card padded={false}>
        {others.map((m, i) => <MemberRow key={m.member_id} member={m} last={i === others.length - 1} actions={<>
          {m.status === 'active' ? small(m, 'suspend', 'secondary', 'pause') : null}
          {m.status === 'suspended' ? small(m, 'reactivate', 'secondary', 'play', full) : null}
          {small(m, 'remove', 'danger', 'trash-outline')}
        </>} />)}
      </Card>
    </> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  linkHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: colors.bg, borderRadius: 12, padding: 8, paddingLeft: 12 },
  linkText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },
  linkActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  qrBox: { alignItems: 'center', marginTop: 14 },
  qr: { width: 220, height: 220 },
  statusIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16, marginTop: 16 },
  homeHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  shopLine: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.primary },
  stats: { flexDirection: 'row', gap: 12, marginTop: 16 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 4, shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  statValue: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: colors.ink },
  statLabel: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  seatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  seatBar: { height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: 8, overflow: 'hidden' },
  seatFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  member: { padding: 16 },
  memberLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberName: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, color: colors.ink },
  memberPhone: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  memberActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
