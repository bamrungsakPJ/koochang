import Constants from 'expo-constants';
import { useContext, useState } from 'react';
import { Image, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { apiBaseUrl } from '../api';
import { Badge, Card, colors, fonts, LanguageContext, Row, Screen, Sub, useT } from '../ui';

// Read the installed app manifest rather than maintaining a second version string.
export const appVersion = Constants.expoConfig?.version ?? '—';
export const appBuild = String(Platform.OS === 'ios'
  ? Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber ?? '—'
  : Constants.platform?.android?.versionCode ?? Constants.expoConfig?.android?.versionCode ?? '—');
/** Anything that is not the production API is a test system; production shows no badge. */
const testSystem = /staging|localhost|127\.0\.0\.1|192\.168\./.test(apiBaseUrl);
// Android reports the API level as Platform.Version; the user-facing release ("14") is in constants.
const platformName = Platform.OS === 'android' ? `Android ${(Platform.constants as { Release?: string }).Release ?? Platform.Version}`
  : Platform.OS === 'ios' ? `iOS ${Platform.Version}` : 'Web';

// Public legal pages on the website (Thai); the same pages linked from the landing page footer.
const legalBase = 'https://koochang.com';

/** Version lives here (Account → About, or the link under sign-in), never on working screens. */
export function About({ onBack }: { onBack: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const [shared, setShared] = useState(false);
  const company = Constants.expoConfig?.extra?.company as { th?: string; en?: string } | undefined;
  const companyName = (language === 'th' ? company?.th : company?.en) || company?.th || company?.en;
  const versionText = t('appVersionLabel', { version: appVersion, build: appBuild });
  async function share() {
    const lines = [`KooChang ${appVersion} (Build ${appBuild})`, `${t('appSystem')}: ${testSystem ? t('appSystemTest') : t('appSystemLive')}`, `${t('appDevice')}: ${platformName}`];
    try { const r = await Share.share({ message: lines.join('\n') }); if (r.action === Share.sharedAction) setShared(true); } catch { /* user closed the sheet */ }
  }
  return <Screen onBack={onBack}>
    <View style={styles.hero}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
      <Text style={styles.name}>{t('appName')}</Text>
      <Sub>{versionText}</Sub>
    </View>
    <Text style={styles.section}>{t('appDetails')}</Text>
    <Card padded={false}>
      <Row title={t('appVersion')} trailing={<Text style={styles.value}>{`${appVersion} (${appBuild})`}</Text>} />
      {testSystem ? <Row title={t('appSystem')} trailing={<Badge text={t('appSystemTest')} tone="warn" />} /> : null}
      <Row title={t('appDevice')} trailing={<Text style={styles.value}>{platformName}</Text>} last />
    </Card>
    <Card padded={false}>
      <Row icon="share-outline" tone="blue" title={t('appShareInfo')} subtitle={shared ? t('appShared') : t('appShareInfoHint')} onPress={() => { void share(); }} last />
    </Card>
    <Text style={styles.section}>{t('legalLinks')}</Text>
    <Card padded={false}>
      <Row icon="shield-checkmark-outline" tone="blue" title={t('privacyPolicy')} onPress={() => { void Linking.openURL(`${legalBase}/privacy`); }} />
      <Row icon="document-text-outline" tone="blue" title={t('termsOfUse')} onPress={() => { void Linking.openURL(`${legalBase}/terms`); }} last />
    </Card>
    {companyName ? <Text style={styles.footer}>© {new Date().getFullYear()} {companyName}</Text> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4, marginTop: 8, marginBottom: 8 },
  logo: { width: 72, height: 72, borderRadius: 18 },
  name: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.ink, marginTop: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 4 },
  value: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  footer: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 8 },
});
