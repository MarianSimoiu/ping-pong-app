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

// Asks "are you sure?" and resolves true if they confirm. On the web this is
// the browser's own confirm() (React Native Web has no Alert dialogs).
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(message ? `${title}\n\n${message}` : title)
      : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
