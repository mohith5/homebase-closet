import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '../theme';

export function Pill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inpBg,
    margin: 3,
  },
  pillActive: {
    borderColor: Colors.accent2,
    backgroundColor: 'rgba(29,78,216,0.2)',
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.text2,
  },
  labelActive: {
    color: Colors.accent2,
    fontWeight: '600',
  },
});
