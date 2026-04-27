import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import WardrobeScreen from '../screens/wardrobe/WardrobeScreen';
import OutfitsScreen from '../screens/outfits/OutfitsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { Colors } from '../theme';

const Tab = createBottomTabNavigator();

const TABS = {
  Wardrobe: { label: 'Wardrobe', icon: '⊟', iconActive: '⊞' },
  Outfits:  { label: 'Stylie',   icon: '◇',  iconActive: '◆' },
  Profile:  { label: 'Profile',  icon: '○',  iconActive: '●' },
};

function TabIcon({ name, focused }) {
  const t = TABS[name];
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Text style={[styles.icon, focused && styles.iconActive]}>
        {focused ? t.iconActive : t.icon}
      </Text>
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
              {TABS[route.name]?.label || route.name}
            </Text>
          ),
          tabBarStyle: styles.tabBar,
          tabBarHideOnKeyboard: true,
        })}
      >
        <Tab.Screen name="Wardrobe" component={WardrobeScreen} />
        <Tab.Screen name="Outfits"  component={OutfitsScreen} />
        <Tab.Screen name="Profile"  component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.tabBar,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 74,
    paddingBottom: 10,
    paddingTop: 6,
  },
  iconWrap: {
    width: 40, height: 32,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: Colors.accentBg,
  },
  icon: {
    fontSize: 20,
    color: Colors.text3,
    lineHeight: 24,
  },
  iconActive: {
    color: Colors.accent2,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.text3,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  labelActive: {
    color: Colors.accent2,
    fontWeight: '700',
  },
});
