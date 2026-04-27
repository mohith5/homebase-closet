import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import WardrobeScreen from '../screens/wardrobe/WardrobeScreen';
import OutfitsScreen from '../screens/outfits/OutfitsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { Colors } from '../theme';

const Tab = createBottomTabNavigator();

// Clean geometric icons — no emoji
const ICONS = {
  Wardrobe: {
    active:   '▣',  // filled grid
    inactive: '▢',
    label: 'Wardrobe',
  },
  Outfits: {
    active:   '✦',
    inactive: '✧',
    label: 'Stylie',
  },
  Profile: {
    active:   '◉',
    inactive: '○',
    label: 'Profile',
  },
};

function TabIcon({ name, focused }) {
  const icon = ICONS[name];
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.icon, focused && styles.iconActive]}>
        {focused ? icon.active : icon.inactive}
      </Text>
      {focused && <View style={styles.dot} />}
    </View>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.label, focused && styles.labelActive]}>
              {ICONS[route.name]?.label || route.name}
            </Text>
          ),
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: Colors.accent2,
          tabBarInactiveTintColor: Colors.text3,
          tabBarHideOnKeyboard: true,
        })}
      >
        <Tab.Screen name="Wardrobe" component={WardrobeScreen} />
        <Tab.Screen name="Outfits" component={OutfitsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(8,12,20,0.98)',
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 1,
    height: 72,
    paddingBottom: 10,
    paddingTop: 8,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: {
    fontSize: 18,
    color: Colors.text3,
    lineHeight: 22,
  },
  iconActive: {
    color: Colors.accent2,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.accent2,
    marginTop: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.text3,
    letterSpacing: 0.3,
    marginTop: -2,
  },
  labelActive: {
    color: Colors.accent2,
    fontWeight: '700',
  },
});
