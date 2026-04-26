import { Platform, StatusBar, Dimensions } from 'react-native';
import Constants from 'expo-constants';

// Reliable status bar height on both iOS and Android
export const STATUS_BAR_HEIGHT = Platform.select({
  ios: Constants.statusBarHeight || 44,
  android: StatusBar.currentHeight || 24,
  default: 24,
});

// Header height = status bar + title area
export const HEADER_PADDING_TOP = STATUS_BAR_HEIGHT + 8;

export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';
export const SCREEN_WIDTH = Dimensions.get('window').width;
export const SCREEN_HEIGHT = Dimensions.get('window').height;
