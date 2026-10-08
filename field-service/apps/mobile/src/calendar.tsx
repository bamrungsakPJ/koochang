import { useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, Icon, LanguageContext, useT } from './ui';

/** Dates are plain YYYY-MM-DD days (Bangkok calendar); arithmetic is done in UTC so the device's
 * own time zone never shifts a day. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
function addMonth(start: string, n: number) {
  const [y, m] = start.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** A month grid without a native date-picker dependency: Thai months and Buddhist-era years in
 * Thai, Gregorian in English, weeks start on Sunday as on Thai calendars. */
export function DatePicker({ value, min, max, onChange }: { value: string | null; min: string; max: string; onChange: (day: string) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const [month, setMonth] = useState(monthStart(value ?? min));
  const locale = language === 'th' ? 'th-TH-u-ca-buddhist-nu-latn' : 'en-GB-u-ca-gregory-nu-latn';
  const title = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}T00:00:00Z`));
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(Date.UTC(2026, 0, 4 + i)))), [locale]);
  const cells = useMemo(() => {
    const first = new Date(`${month}T00:00:00Z`).getUTCDay();
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    return [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => addDays(month, i))];
  }, [month]);
  const canBack = month > monthStart(min), canNext = addMonth(month, 1) <= max;
  return <View style={styles.box}>
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('prevMonth')} disabled={!canBack} hitSlop={8} onPress={() => setMonth(addMonth(month, -1))}>
        <Icon name="chevron-back" size={22} color={canBack ? colors.primary : colors.line} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('nextMonth')} disabled={!canNext} hitSlop={8} onPress={() => setMonth(addMonth(month, 1))}>
        <Icon name="chevron-forward" size={22} color={canNext ? colors.primary : colors.line} />
      </Pressable>
    </View>
    <View style={styles.grid}>
      {weekdays.map(w => <Text key={w} style={styles.weekday}>{w}</Text>)}
      {cells.map((d, i) => {
        if (!d) return <View key={`blank${i}`} style={styles.cell} />;
        const off = d < min || d > max, on = d === value;
        return <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }} disabled={off}
          onPress={() => onChange(d)} style={styles.cell}>
          <View style={[styles.day, on && styles.dayOn]}><Text style={[styles.dayText, off && styles.dayOff, on && styles.dayTextOn]}>{Number(d.slice(8))}</Text></View>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 10, marginTop: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.medium, fontSize: 12, lineHeight: 20, color: colors.muted },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.primary },
  dayText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.ink },
  dayOff: { color: colors.line },
  dayTextOn: { color: colors.onPrimary },
});
