import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { color } from '../src/theme';
import { useHerald } from '../src/state/herald';

/**
 * The gate. Sends the user to pairing, onboarding or the app proper depending
 * on how far they have got, so there is exactly one place that decides.
 */
export default function Index() {
  const { phase } = useHerald();

  switch (phase) {
    case 'loading':
      // Blank onyx rather than a spinner: this resolves from local storage in
      // a frame or two, and a flash of spinner would be noisier than nothing.
      return <View style={{ flex: 1, backgroundColor: color.onyx }} />;
    case 'unpaired':
      return <Redirect href="/setup" />;
    case 'onboarding':
      return <Redirect href="/onboarding" />;
    case 'ready':
      return <Redirect href="/(tabs)/today" />;
  }
}
