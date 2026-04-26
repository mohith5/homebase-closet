import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import Logger from './src/lib/logger';
import { supabase } from './src/lib/supabase';
import { useAppStore } from './src/store';
import AuthScreen from './src/screens/auth/AuthScreen';
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { Toast } from './src/components/Toast';
import { Colors } from './src/theme';

Logger.info('App', '🚀 HomeBase Closet starting up');

export default function App() {
  const { session, householdId, profiles, setSession, setHouseholdId, setProfiles, toastMsg } = useAppStore();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    Logger.info('App', 'Initializing auth listener');

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) Logger.error('App', 'getSession error', error);
      else Logger.info('App', 'Initial session', { userId: session?.user?.id });
      useAppStore.getState().setSession(session);
      if (session) loadHousehold(session.user.id);
      else setBooting(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      Logger.info('App', `Auth event: ${event}`, { userId: session?.user?.id });
      useAppStore.getState().setSession(session);
      if (session) loadHousehold(session.user.id);
      else { setBooting(false); setHouseholdId(null); setProfiles([]); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadHousehold(userId) {
    Logger.info('App', 'Loading household', { userId });
    const done = Logger.perf('App', 'loadHousehold');
    try {
      const { data: hm, error: hmErr } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (hmErr || !hm) {
        Logger.warn('App', 'No household found', hmErr);
        setBooting(false);
        return;
      }
      setHouseholdId(hm.household_id);
      Logger.info('App', 'Household found', { householdId: hm.household_id });

      const { data: profs, error: profErr } = await supabase
        .from('closet_profiles')
        .select('*')
        .eq('household_id', hm.household_id)
        .order('created_at');

      if (profErr) Logger.error('App', 'Profiles load error', profErr);
      else {
        Logger.info('App', `Loaded ${profs?.length} profiles`);
        setProfiles(profs || []);
      }
    } catch (e) {
      Logger.error('App', 'loadHousehold threw', e);
    }
    done();
    setBooting(false);
  }

  if (booting) return (
    <View style={styles.boot}>
      <ActivityIndicator color={Colors.accent2} size="large" />
    </View>
  );

  const needsAuth = !session;
  const needsOnboarding = session && profiles.length === 0;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {needsAuth && <AuthScreen />}
        {!needsAuth && needsOnboarding && (
          <OnboardingScreen onComplete={() => {
            Logger.info('App', 'Onboarding complete — reloading profiles');
            loadHousehold(session.user.id);
          }} />
        )}
        {!needsAuth && !needsOnboarding && <AppNavigator />}
        {toastMsg && <Toast msg={toastMsg} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
});
