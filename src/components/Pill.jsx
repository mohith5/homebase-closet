import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '../theme';

export function Pill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.65}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    margin: 3,
  },
  pillActive: {
    borderColor: 'rgba(125,211,252,0.4)',
    backgroundColor: 'rgba(29,78,216,0.2)',
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.text3,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: Colors.accent2,
    fontWeight: '700',
  },
});
