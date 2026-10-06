import Constants from 'expo-constants';
import { Platform, StyleSheet, Text } from 'react-native';
import { useContext } from 'react';
import { Card, colors, fonts, LanguageContext, Screen, Strong, Sub, Title, useT } from '../ui';

// Read the installed app manifest rather than maintaining a second version string.
export const appVersion = Constants.expoConfig?.version ?? '—';
export const appBuild = String(Platform.OS === 'ios'
  ? Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber ?? '—'
  : Constants.platform?.android?.versionCode ?? Constants.expoConfig?.android?.versionCode ?? '—');

export function VersionLabel({ light = false }: { light?: boolean }) {
  const t = useT();
  return <Text style={[styles.version, light && styles.light]}>{t('appVersionLabel', { version: appVersion, build: appBuild })}</Text>;
}

export function About({ onBack }: { onBack: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const company = Constants.expoConfig?.extra?.company as { th?: string; en?: string } | undefined;
  const companyName = (language === 'th' ? company?.th : company?.en) || company?.th || company?.en;
  return <Screen onBack={onBack}>
    <Title>{t('aboutApp')}</Title>
    <Card>
      <Strong>KooChang — คู่ช่าง</Strong>
      <Sub>{t('aboutAppDescription')}</Sub>
      <VersionLabel />
    </Card>
    <Card>
      <Strong>{t('appCompany')}</Strong>
      <Sub>{companyName || t('appCompanyPending')}</Sub>
    </Card>
    <Card>
      <Strong>{t('appDetails')}</Strong>
      <Sub>{t('appVersion')}: {appVersion}</Sub>
      <Sub>{t('appBuild')}: {appBuild}</Sub>
      <Sub>{t('appPlatform')}: {Platform.OS === 'android' ? 'Android' : Platform.OS === 'ios' ? 'iOS' : 'Web'}</Sub>
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  version: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center', marginTop: 12 },
  light: { color: '#F8FAFC', fontFamily: undefined },
});
