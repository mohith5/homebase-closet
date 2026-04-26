import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import WardrobeScreen from '../screens/wardrobe/WardrobeScreen';
import OutfitsScreen from '../screens/outfits/OutfitsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { Colors } from '../theme';

const Tab = createBottomTabNavigator();

const TAB_ICONS = { Wardrobe: '👕', Outfits: '✨', Profile: '👤' };

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{TAB_ICONS[route.name]}</Text>
          ),
          tabBarLabel: ({ focused, children }) => (
            <Text style={{ fontSize: 10, fontWeight: focused ? '700' : '500', color: focused ? Colors.accent2 : Colors.text3, marginBottom: 2 }}>
              {children}
            </Text>
          ),
          tabBarStyle: {
            backgroundColor: 'rgba(10,14,24,0.97)',
            borderTopColor: Colors.border,
            borderTopWidth: 1,
            height: 80,
            paddingBottom: 12,
          },
          tabBarActiveTintColor: Colors.accent2,
          tabBarInactiveTintColor: Colors.text3,
        })}
      >
        <Tab.Screen name="Wardrobe" component={WardrobeScreen} />
        <Tab.Screen name="Outfits" component={OutfitsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
