import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { Colors, Gradients, Spacing, Radius, Typography } from '../../theme';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('login'); // login | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  async function handleSubmit() {
    if (!email.trim() || (!password.trim() && mode !== 'reset')) {
      setMsg({ text: 'Please fill in all fields', isError: true }); return;
    }
    setLoading(true); setMsg({ text: '', isError: false });
    Logger.info('Auth', `Attempting ${mode}`, { email });

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        Logger.info('Auth', 'Login success');
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setMsg({ text: 'Check your email to confirm your account, then sign in.', isError: false });
        Logger.info('Auth', 'Signup success — awaiting email confirmation');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
        setMsg({ text: 'Password reset email sent. Check your inbox.', isError: false });
        Logger.info('Auth', 'Password reset email sent');
      }
    } catch (e) {
      Logger.error('Auth', `${mode} failed`, e);
      setMsg({ text: e.message || 'Something went wrong.', isError: true });
    }
    setLoading(false);
  }

  return (
    <LinearGradient colors={Gradients.header} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.icon}>👗</Text>
          <Text style={styles.title}>HomeBase Closet</Text>
          <Text style={styles.subtitle}>Your personal AI stylist</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              placeholderTextColor={Colors.text3}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            {mode !== 'reset' && (
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={Colors.text3}
                secureTextEntry
                autoComplete={mode === 'signup' ? 'new-password' : 'password'}
              />
            )}

            {msg.text ? (
              <Text style={[styles.msg, { color: msg.isError ? Colors.error : Colors.success }]}>
                {msg.text}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.btn, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              <LinearGradient colors={Gradients.accent} style={styles.btnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>
                      {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
                    </Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.links}>
              {mode !== 'login' && (
                <TouchableOpacity onPress={() => { setMode('login'); setMsg({ text: '', isError: false }); }}>
                  <Text style={styles.link}>Sign in instead</Text>
                </TouchableOpacity>
              )}
              {mode !== 'signup' && (
                <TouchableOpacity onPress={() => { setMode('signup'); setMsg({ text: '', isError: false }); }}>
                  <Text style={styles.link}>Create account</Text>
                </TouchableOpacity>
              )}
              {mode !== 'reset' && (
                <TouchableOpacity onPress={() => { setMode('reset'); setMsg({ text: '', isError: false }); }}>
                  <Text style={[styles.link, { color: Colors.text3 }]}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.footer}>Linked to your HomeBase household</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', padding: Spacing.lg },
  icon: { fontSize: 56, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  subtitle: { fontSize: 15, color: Colors.text2, marginBottom: 40 },
  form: { width: '100%', maxWidth: 380 },
  input: {
    backgroundColor: Colors.inpBg,
    borderWidth: 1,
    borderColor: Colors.inpBorder,
    borderRadius: Radius.md,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 12,
  },
  msg: { fontSize: 13, textAlign: 'center', marginBottom: 12, lineHeight: 18 },
  btn: { borderRadius: Radius.md, overflow: 'hidden', marginBottom: 20 },
  btnGrad: { padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  links: { gap: 12, alignItems: 'center' },
  link: { fontSize: 14, color: Colors.accent2, fontWeight: '500' },
  footer: { marginTop: 40, fontSize: 12, color: Colors.text3 },
});
