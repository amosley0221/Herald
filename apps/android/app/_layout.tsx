import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { color } from '../src/theme';
import { ACTIONS, readPayload } from '../src/lib/notifications';
import { HeraldProvider, useHerald } from '../src/state/herald';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Cinzel-Medium': require('../assets/fonts/Cinzel-Medium.ttf'),
    'Cinzel-SemiBold': require('../assets/fonts/Cinzel-SemiBold.ttf'),
    'Cinzel-Bold': require('../assets/fonts/Cinzel-Bold.ttf'),
    'Jost-Light': require('../assets/fonts/Jost-Light.ttf'),
    'Jost-Regular': require('../assets/fonts/Jost-Regular.ttf'),
    'Jost-Medium': require('../assets/fonts/Jost-Medium.ttf'),
  });

  useEffect(() => {
    // Hide the splash once type is ready — or once loading has definitively
    // failed, since a font error must not leave the user on a blank screen.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <HeraldProvider>
        <View style={{ flex: 1, backgroundColor: color.onyx }}>
          <StatusBar style="light" />
          <NotificationRouter />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.onyx },
              // Opacity only. The design rules out slide-ins.
              animation: 'fade',
              animationDuration: 200,
            }}
          />
        </View>
      </HeraldProvider>
    </SafeAreaProvider>
  );
}

/**
 * Turns a notification tap into navigation.
 *
 * Approve goes straight to the Review screen, since approving is what the user
 * already decided by pressing the button. View opens the detail. Skip resolves
 * without opening the app at all, so it is handled here only for the case where
 * the OS delivers it while the app happens to be running.
 */
function NotificationRouter() {
  const { skip, refresh, approve, showToast } = useHerald();

  useEffect(() => {
    let cancelled = false;

    const handle = async (response: Notifications.NotificationResponse) => {
      const payload = readPayload(response.notification);
      const action = response.actionIdentifier;

      if (payload.type === 'digest') {
        router.push('/(tabs)/matches');
        return;
      }
      if (!payload.matchId) return;

      if (action === ACTIONS.skip) {
        await skip(payload.matchId).catch(() => undefined);
        return;
      }
      if (action === ACTIONS.approve) {
        try {
          await approve(payload.matchId);
          if (!cancelled) router.push(`/review/${payload.matchId}`);
        } catch {
          // Preparing can fail (the form may be unreachable); send the user to
          // the detail screen so they can see the posting and decide.
          showToast('Could not prepare that application.', 'danger');
          if (!cancelled) router.push(`/match/${payload.matchId}`);
        }
        return;
      }
      // A plain tap, or the View action.
      router.push(`/match/${payload.matchId}`);
    };

    // A notification that launched the app from cold is waiting here.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !cancelled) void handle(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response);
    });
    // A push arriving in the foreground means the feed is stale.
    const received = Notifications.addNotificationReceivedListener(() => { void refresh(); });

    return () => {
      cancelled = true;
      subscription.remove();
      received.remove();
    };
  }, [approve, refresh, showToast, skip]);

  return null;
}
