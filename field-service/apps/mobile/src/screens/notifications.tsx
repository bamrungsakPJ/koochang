import { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatDateTime, translate, type TranslationKey } from '@field-service/i18n';
import { api, type Inbox, type InboxItem, type Membership } from '../api';
import { Banner, Button, Card, colors, fonts, IconTile, LanguageContext, Loading, Screen, Sub, Title, useErrorText, useT, type IconName, type Tone } from '../ui';

const look: Record<string, [IconName, Tone]> = {
  join_request: ['person-add', 'blue'], member_approved: ['checkmark-circle', 'green'], trial_ending: ['hourglass', 'amber'],
  renewal_due: ['calendar', 'amber'], payment_overdue: ['alert-circle', 'rose'], subscription_expired: ['close-circle', 'rose'],
  subscription_ended: ['stop-circle', 'rose'], storage_threshold: ['images', 'violet'], job_assigned: ['briefcase', 'blue'],
  job_unassigned: ['swap-horizontal', 'amber'], job_rescheduled: ['calendar', 'amber'], job_cancelled: ['close-circle', 'rose'],
  autopay_upcoming: ['card', 'blue'], autopay_failed: ['card', 'rose'], autopay_stopped: ['card', 'rose'], payment_confirmed: ['checkmark-circle', 'green'],
  plan_change_notice: ['pricetag', 'amber'], plan_change_better: ['pricetag', 'green'],
};

/** Text is rendered here from template + parameters, so it follows the reader's language. */
export function useNotificationText() {
  const language = useContext(LanguageContext);
  return (item: Pick<InboxItem, 'template_key' | 'parameters'>) => {
    const params = Object.fromEntries(Object.entries(item.parameters ?? {}).map(([k, v]) =>
      [k, k === 'date' && typeof v === 'string' ? formatDate(new Date(`${v}T12:00:00+07:00`), language)
        : k === 'when' && typeof v === 'string' && v ? formatDateTime(new Date(`${v}:00+07:00`), language) : String(v)]));
    return translate(language, `notify.${item.template_key}` as TranslationKey, params);
  };
}

/** Bell with unread count for the home header. */
export function useUnread(organizationId: string) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => { api.notifications(organizationId).then(r => setUnread(r.unread), () => {}); }, [organizationId]);
  useEffect(refresh, [refresh]);
  return { unread, refresh };
}

export function NotificationsScreen({ membership, onBack, onOpen }: { membership: Membership; onBack: () => void; onOpen: (item: InboxItem) => void }) {
  const t = useT();
  const text = useNotificationText();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcements,setAnnouncements]=useState<{id:string;title_th:string;title_en:string;body_th:string;body_en:string;publish_at:string}[]>([]);
  useEffect(()=>{setAnnouncements([]);if(membership.role==='owner')api.announcements(membership.organization_id).then(r=>setAnnouncements(r.items),e=>setError(errorText(e)));},[membership.organization_id,membership.role]);
  const load = useCallback(() => { api.notifications(membership.organization_id).then(setInbox, e => setError(errorText(e))); }, [membership.organization_id]);
  useEffect(load, [load]);

  async function open(item: InboxItem) {
    if (!item.read_at) { try { setInbox(await api.markRead(membership.organization_id, [item.id])); } catch { /* shown as unread */ } }
    onOpen(item);
  }
  if (!inbox) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  return <Screen onBack={onBack}>
    <Title>{t('notifications')}</Title>
    {announcements.map(item=><Card key={item.id}><Title>{language==='th'?item.title_th:item.title_en}</Title><Text style={styles.text}>{language==='th'?item.body_th:item.body_en}</Text><Sub>{formatDate(new Date(item.publish_at),language)}</Sub></Card>)}
    {inbox.unread ? <Button small kind="secondary" icon="checkmark-done" title={t('markAllRead')}
      onPress={async () => { try { setInbox(await api.markRead(membership.organization_id)); } catch (e) { setError(errorText(e)); } }} /> : null}
    <Banner text={error} />
    {inbox.items.length === 0 ? <Card><Sub>{t('noNotifications')}</Sub></Card> : <Card padded={false}>
      {inbox.items.map((item, i) => {
        const [icon, tone] = look[item.template_key] ?? ['notifications', 'blue'];
        return <Pressable key={item.id} accessibilityRole="button" onPress={() => open(item)}
          style={({ pressed }) => [styles.row, i < inbox.items.length - 1 && styles.line, pressed && { backgroundColor: colors.bg }]}>
          <IconTile icon={icon} tone={tone} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.text, !item.read_at && styles.unread]}>{text(item)}</Text>
            <Text style={styles.date}>{formatDate(new Date(item.created_at), language)}</Text>
          </View>
          {!item.read_at ? <View style={styles.dot} /> : null}
        </Pressable>;
      })}
    </Card>}
  </Screen>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  text: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  unread: { fontFamily: fonts.semibold },
  date: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
});
