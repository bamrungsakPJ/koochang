import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors } from './ui';

/** Built with a Google Maps key (see app.config.js). Without one, Google Maps would crash the app,
 * so no map is shown and the "open in Google Maps" buttons remain the way to see the place. */
export const mapsEnabled = Platform.OS === 'android' && Boolean(Constants.expoConfig?.extra?.mapsEnabled);

/** A small fixed map of one point with a pin (lite mode: a picture, no gestures). Tapping it
 * opens Google Maps for directions. Shows only coordinates already saved or just captured. */
export function MapPreview({ latitude, longitude, onPress, height = 150 }: { latitude: number; longitude: number; onPress?: () => void; height?: number }) {
  if (!mapsEnabled) return null;
  const region = { latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 };
  return <Pressable onPress={onPress} accessibilityRole="imagebutton" disabled={!onPress} style={[styles.frame, { height }]}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <MapView provider={PROVIDER_GOOGLE} liteMode style={StyleSheet.absoluteFill} region={region} scrollEnabled={false} zoomEnabled={false}
        rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} showsUserLocation={false} showsMyLocationButton={false}>
        <Marker coordinate={{ latitude, longitude }} pinColor={colors.primary} />
      </MapView>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({ frame: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.line, marginTop: 8 } });
