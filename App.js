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
      let householdId = null;

      // Try to find existing household membership
      const { data: hm, error: hmErr } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (hm?.household_id) {
        householdId = hm.household_id;
        Logger.info('App', 'Existing household found', { householdId });
      } else {
        // No household — create one automatically for this user
        Logger.info('App', 'No household found — creating one', { userId });

        const { data: newHousehold, error: hhErr } = await supabase
          .from('households')
          .insert({ name: 'My Home' })
          .select()
          .single();

        if (hhErr) {
          Logger.error('App', 'Failed to create household', hhErr);
          setBooting(false);
          return;
        }

        const { error: memberErr } = await supabase
          .from('household_members')
          .insert({ household_id: newHousehold.id, user_id: userId, role: 'admin' });

        if (memberErr) {
          Logger.error('App', 'Failed to add household member', memberErr);
          setBooting(false);
          return;
        }

        householdId = newHousehold.id;
        Logger.info('App', 'New household created', { householdId });
      }

      setHouseholdId(householdId);

      // Load closet profiles for this household
      const { data: profs, error: profErr } = await supabase
        .from('closet_profiles')
        .select('*')
        .eq('household_id', householdId)
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
