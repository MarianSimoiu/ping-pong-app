import { Alert, Platform } from 'react-native';

// React Native Web's Alert.alert is a documented no-op (it renders nothing —
// see react-native-web/src/exports/Alert), so on web we fall back to the
// browser's own alert(). Native platforms use the real Alert.alert.
export function showAlert(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
