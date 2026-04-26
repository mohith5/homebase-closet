import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { Colors, Gradients, Spacing, Radius } from '../../theme';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email'); // email | otp
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  function setInfo(text) { setMsg({ text, isError: false }); }
  function setError(text) { setMsg({ text, isError: true }); }

  async function sendOtp() {
    if (!email.trim()) { setError('Enter your email address'); return; }
    setLoading(true);
    setMsg({ text: '', isError: false });
    Logger.info('Auth', 'Sending OTP code', { email });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          // No emailRedirectTo — forces Supabase to send a 6-digit code, not a magic link
          data: { type: 'otp' },
        },
      });
      if (error) throw error;
      setStep('otp');
      setInfo('Check your email for a 6-digit code.');
      Logger.info('Auth', 'OTP sent OK');
    } catch (e) {
      Logger.error('Auth', 'OTP send failed', e);
      setError(e.message || 'Could not send code. Try again.');
    }
    setLoading(false);
  }

  async function verifyOtp() {
    if (otp.trim().length < 6) { setError('Enter the full 6-digit code'); return; }
    setLoading(true);
    setMsg({ text: '', isError: false });
    Logger.info('Auth', 'Verifying OTP');
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'email',
      });
      if (error) throw error;
      Logger.info('Auth', 'OTP verified — signed in', { userId: data.user?.id });
    } catch (e) {
      Logger.error('Auth', 'OTP verify failed', e);
      setError('Invalid or expired code. Request a new one.');
    }
    setLoading(false);
  }

  return (
    <LinearGradient colors={Gradients.header} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.icon}>👗</Text>
          <Text style={styles.title}>HomeBase Closet</Text>
          <Text style={styles.subtitle}>Sign in with your HomeBase email</Text>

          <View style={styles.form}>

            {step === 'email' && (
              <>
                <Text style={styles.fieldLabel}>Your email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  placeholderTextColor={Colors.text3}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={sendOtp}
                />
                <TouchableOpacity
                  onPress={sendOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                  style={styles.btn}
                >
                  <LinearGradient
                    colors={Gradients.accent}
                    style={styles.btnGrad}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.btnText}>Send 6-Digit Code</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {step === 'otp' && (
              <>
                <Text style={styles.otpHint}>
                  We sent a 6-digit code to{'\n'}
                  <Text style={{ color: Colors.accent2, fontWeight: '700' }}>{email}</Text>
                  {'\n\n'}Enter it below — ignore the magic link in the same email.
                </Text>
                <TextInput
                  style={styles.otpInput}
                  value={otp}
                  onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={Colors.text3}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={verifyOtp}
                />
                <TouchableOpacity
                  onPress={verifyOtp}
                  disabled={loading || otp.length < 6}
                  activeOpacity={0.85}
                  style={styles.btn}
                >
                  <LinearGradient
                    colors={otp.length === 6 ? Gradients.accent : ['#334155', '#334155']}
                    style={styles.btnGrad}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.btnText}>Verify & Sign In</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>

                <View style={styles.row}>
                  <TouchableOpacity onPress={() => { setStep('email'); setOtp(''); setMsg({ text:'', isError:false }); }}>
                    <Text style={styles.link}>← Different email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={sendOtp} disabled={loading}>
                    <Text style={[styles.link, { color: Colors.text3 }]}>Resend code</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {msg.text ? (
              <Text style={[styles.msg, { color: msg.isError ? Colors.error : Colors.success }]}>
                {msg.text}
              </Text>
            ) : null}

          </View>

          <Text style={styles.footer}>Same account as HomeBase · Secure · Private</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', padding: Spacing.lg },
  icon: { fontSize: 60, marginBottom: 14 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.text2, marginBottom: 36, textAlign: 'center' },
  form: { width: '100%', maxWidth: 380 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: {
    backgroundColor: Colors.inpBg,
    borderWidth: 1,
    borderColor: Colors.inpBorder,
    borderRadius: Radius.md,
    padding: 14,
    fontSize: 16,
    color: Colors.text,
    marginBottom: 14,
  },
  otpInput: {
    backgroundColor: Colors.inpBg,
    borderWidth: 1,
    borderColor: Colors.accent2,
    borderRadius: Radius.md,
    padding: 16,
    fontSize: 36,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 14,
  },
  otpHint: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  btn: { borderRadius: Radius.md, overflow: 'hidden', marginBottom: 16 },
  btnGrad: { padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  link: { fontSize: 14, color: Colors.accent2, fontWeight: '500', padding: 4 },
  msg: { fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  footer: { marginTop: 48, fontSize: 12, color: Colors.text3, textAlign: 'center' },
});
