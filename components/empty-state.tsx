import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { SvgUri } from 'react-native-svg';
import { Asset } from 'expo-asset';

const { width: SCREEN_W } = Dimensions.get('window');

export function EmptyState() {
  const illuSize = Math.min(SCREEN_W * 0.6, 280);
  const [uri, setUri] = useState<string | null>(null);

  // Resolve the local URI for the packaged SVG using expo-asset
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@/assets/images/14.svg');
        const asset = Asset.fromModule(mod);
        await asset.downloadAsync();
        if (mounted) setUri(asset.localUri ?? asset.uri);
      } catch {
        if (mounted) setUri(null);
      }
    })();
    return () => { mounted = false };
  }, []);

  return (
    <View style={styles.wrap}>
      <View accessible accessibilityRole="image" accessibilityLabel="Empty. No sessions found">
        {uri ? (
          <SvgUri uri={uri} width={illuSize} height={illuSize} />
        ) : (
          <View style={[styles.illuFallback, { width: illuSize, height: illuSize }]} />
        )}
      </View>
      <Heading size="lg" className="mt-6 text-center">Get started</Heading>
      <Text size="md" className="mt-2 text-center text-typography-600" accessibilityRole="text">
        No sessions yet. Tap the + icon to capture a new photo and start your first edit.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  illuFallback: {
    opacity: 0.08,
    borderRadius: 16,
    backgroundColor: '#888'
  }
});

export default EmptyState;
