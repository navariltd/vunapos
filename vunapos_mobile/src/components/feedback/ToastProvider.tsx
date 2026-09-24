import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

export type ToastSeverity = "success" | "error" | "info" | "warning";

export type ToastAction = {
  label: string;
  onPress: () => void;
};

export type ToastOptions = {
  title?: string;
  message: string;
  severity?: ToastSeverity;
  duration?: number;
  action?: ToastAction;
  /** Identical keys replace an existing toast instead of stacking duplicates. */
  dedupeKey?: string;
};

type Toast = ToastOptions & { id: number; severity: ToastSeverity };

type ToastContextValue = {
  show: (options: ToastOptions) => number;
  success: (message: string, options?: Omit<ToastOptions, "message" | "severity">) => number;
  error: (message: string, options?: Omit<ToastOptions, "message" | "severity">) => number;
  info: (message: string, options?: Omit<ToastOptions, "message" | "severity">) => number;
  warning: (message: string, options?: Omit<ToastOptions, "message" | "severity">) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
};

const noop = () => 0;
const ToastContext = createContext<ToastContextValue>({
  dismiss: () => undefined,
  dismissAll: () => undefined,
  error: noop,
  info: noop,
  show: noop,
  success: noop,
  warning: noop,
});

const defaultDuration: Record<ToastSeverity, number> = {
  error: 5600,
  info: 3600,
  success: 3400,
  warning: 5000,
};

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const dismissAll = useCallback(() => setToasts([]), []);
  const show = useCallback((options: ToastOptions) => {
    const severity = options.severity || "info";
    const id = nextId.current++;
    setToasts((current) => {
      const withoutDuplicate = options.dedupeKey
        ? current.filter((toast) => toast.dedupeKey !== options.dedupeKey)
        : current;
      return [
        ...withoutDuplicate,
        {
          ...options,
          duration: options.duration ?? defaultDuration[severity],
          id,
          severity,
        },
      ].slice(-3);
    });
    return id;
  }, []);
  const createSeverity = useCallback(
    (severity: ToastSeverity) =>
      (
        message: string,
        options?: Omit<ToastOptions, "message" | "severity">,
      ) => show({ ...options, message, severity }),
    [show],
  );
  const value = useMemo<ToastContextValue>(
    () => ({
      dismiss,
      dismissAll,
      error: createSeverity("error"),
      info: createSeverity("info"),
      show,
      success: createSeverity("success"),
      warning: createSeverity("warning"),
    }),
    [createSeverity, dismiss, dismissAll, show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost onDismiss={dismiss} toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

function ToastHost({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: number) => void;
  toasts: Toast[];
}) {
  const insets = useSafeAreaInsets();
  const { palette } = useAppearance();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: Math.max(insets.top, 12) + spacing.sm }]}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} onDismiss={onDismiss} palette={palette} toast={toast} />
      ))}
    </View>
  );
}

function ToastCard({
  onDismiss,
  palette,
  toast,
}: {
  onDismiss: (id: number) => void;
  palette: ReturnType<typeof useAppearance>["palette"];
  toast: Toast;
}) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(12));
  const colors = {
    error: { background: palette.errorSurface, icon: "alert-circle-outline" as const, accent: palette.error },
    info: { background: palette.surfaceContainerHigh, icon: "information-outline" as const, accent: palette.primary },
    success: { background: palette.surfaceContainerHigh, icon: "check-circle-outline" as const, accent: palette.success },
    warning: { background: palette.surfaceContainerHigh, icon: "alert-outline" as const, accent: palette.notification },
  }[toast.severity];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { duration: 180, toValue: 1, useNativeDriver: true }),
      Animated.timing(translateY, { duration: 180, toValue: 0, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [onDismiss, opacity, toast.duration, toast.id, translateY]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      `${toast.title ? `${toast.title}. ` : ""}${toast.message}`,
    );
  }, [toast.message, toast.title]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.card, { backgroundColor: colors.background, borderColor: colors.accent }]}
      >
        <MaterialCommunityIcons color={colors.accent} name={colors.icon} size={22} />
        <View style={styles.copy}>
          {toast.title ? <Text style={[styles.title, { color: palette.onSurface }]}>{toast.title}</Text> : null}
          <Text style={[styles.message, { color: palette.onSurface }]}>{toast.message}</Text>
          {toast.action ? (
            <Pressable accessibilityRole="button" onPress={toast.action.onPress}>
              <Text style={[styles.action, { color: colors.accent }]}>{toast.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable accessibilityLabel="Dismiss notification" onPress={() => onDismiss(toast.id)} hitSlop={8}>
          <MaterialCommunityIcons color={palette.onSurfaceMuted} name="close" size={19} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
    zIndex: 1000,
  },
  card: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    borderWidth: 1,
    elevation: 8,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  message: { fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  action: { fontFamily: typography.fontFamily.semibold, marginTop: spacing.xs },
});
