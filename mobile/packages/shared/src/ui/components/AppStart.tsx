import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/**
 * New in V4: what the four apps show when they cannot start (the local database does not open: storage full, a damaged
 * file) or when a screen fails while drawing. Before, the app stayed on the spinner or closed. RETRY tries again.
 */
export function AppStartError({ message, onRetry, testID = 'app-start-error' }: { message?: string; onRetry: () => void; testID?: string }) {
  return (
    <View style={styles.page} testID={testID}>
      <Text style={styles.title}>The app could not start</Text>
      <Text style={styles.text}>
        {message ?? 'Please try again. If it happens again, free some storage on the phone or restart it, then open the app again.'}
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.pressed]} testID={`${testID}-retry`}>
        <Text style={styles.buttonText}>RETRY</Text>
      </Pressable>
    </View>
  );
}

type BoundaryProps = { children: React.ReactNode; onError?: (error: unknown) => void };
type BoundaryState = { failed: boolean; attempt: number };

/** Catches a screen that fails while drawing: the error page with RETRY (draws the app again) instead of closing. */
export class AppErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  private retry = () => this.setState(s => ({ failed: false, attempt: s.attempt + 1 }));

  override render() {
    if (this.state.failed) {
      return <AppStartError message="Something went wrong on this screen. RETRY opens the app again; your saved work stays on the phone." onRetry={this.retry} testID="app-error" />;
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.white },
  title: { fontSize: 18, fontWeight: '600', color: colors.textColor, textAlign: 'center', marginBottom: 8 },
  text: { fontSize: 14, color: colors.labelColor, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  button: { backgroundColor: colors.appColor, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 40 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
