import { MaterialCommunityIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BarcodeScanningResult, BarcodeType } from "expo-camera";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type PosBarcodeScannerModalProps = {
  isResolving?: boolean;
  onClose: () => void;
  onScan: (barcode: string) => Promise<string | null>;
  visible: boolean;
};

const barcodeTypes: BarcodeType[] = [
  "ean13",
  "ean8",
  "code128",
  "code39",
  "upc_a",
  "upc_e",
  "itf14",
  "qr",
];

/** A single-use camera preview. It unmounts on close so no background preview remains active. */
export function PosBarcodeScannerModal({
  isResolving = false,
  onClose,
  onScan,
  visible,
}: PosBarcodeScannerModalProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scanLocked = useRef(false);
  const insets = useSafeAreaInsets();

  const close = useCallback(() => {
    scanLocked.current = false;
    setIsScanning(false);
    setMessage(null);
    onClose();
  }, [onClose]);

  const scanAgain = useCallback(() => {
    scanLocked.current = false;
    setIsScanning(false);
    setMessage(null);
  }, []);

  const handleBarcodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (scanLocked.current) return;
      if (!data.trim()) {
        setMessage(
          "The code could not be read. Position it inside the frame and try again.",
        );
        return;
      }
      scanLocked.current = true;
      setIsScanning(true);
      setMessage(null);
      const error = await onScan(data);
      if (error) {
        setIsScanning(false);
        setMessage(error);
        return;
      }
      close();
    },
    [close, onScan],
  );

  if (!visible) return null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
      visible
    >
      <View style={styles.modal}>
        <View
          style={[
            styles.header,
            { paddingTop: Math.max(insets.top, spacing.md) },
          ]}
        >
          <View>
            <Text style={styles.title}>Scan barcode</Text>
            <Text style={styles.subtitle}>
              Hold the item barcode inside the frame.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close barcode scanner"
            onPress={close}
            style={styles.closeButton}
          >
            <MaterialCommunityIcons
              color={palette.onSurface}
              name="close"
              size={22}
            />
          </Pressable>
        </View>

        {!permission ? (
          <View style={styles.permissionState}>
            <ActivityIndicator color={palette.primary} />
            <Text style={styles.subtitle}>Preparing camera…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.permissionState}>
            <MaterialCommunityIcons
              color={palette.onSurfaceMuted}
              name="camera-off-outline"
              size={36}
            />
            <Text style={styles.permissionTitle}>Camera access is needed</Text>
            <Text style={styles.permissionMessage}>
              Allow camera access to scan an item barcode. If it remains
              unavailable, use a supported device with a secure app connection.
            </Text>
            <Pressable
              accessibilityLabel="Allow camera access"
              onPress={() => void requestPermission()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonLabel}>Allow camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraArea}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes }}
              facing="back"
              onBarcodeScanned={isScanning ? undefined : handleBarcodeScanned}
              style={StyleSheet.absoluteFill}
              testID="barcode-camera"
            />
            <View pointerEvents="none" style={styles.scanFrame} />
            <View style={styles.scanHint}>
              <Text style={styles.scanHintLabel}>
                Point the camera at a barcode
              </Text>
            </View>
            {isScanning || isResolving ? (
              <View style={styles.processing}>
                <ActivityIndicator color={palette.primary} />
                <Text style={styles.processingLabel}>Looking up item…</Text>
              </View>
            ) : null}
            {message ? (
              <View style={styles.errorPanel}>
                <Text style={styles.errorMessage}>{message}</Text>
                <Pressable
                  accessibilityLabel="Scan another barcode"
                  onPress={scanAgain}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonLabel}>Scan again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <Text style={styles.footerLabel}>
            Only sellable items available to this POS can be added.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  cameraArea: { backgroundColor: "#000000", flex: 1, overflow: "hidden" },
  closeButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  errorMessage: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  errorPanel: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    bottom: spacing.xl,
    gap: spacing.md,
    left: spacing.md,
    padding: spacing.md,
    position: "absolute",
    right: spacing.md,
  },
  footer: {
    backgroundColor: palette.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  footerLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    backgroundColor: palette.background,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  modal: { backgroundColor: palette.background, flex: 1 },
  permissionMessage: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  permissionState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  permissionTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  processing: {
    alignItems: "center",
    backgroundColor: palette.scrim,
    bottom: 0,
    gap: spacing.sm,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  processingLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  scanFrame: {
    borderColor: palette.primary,
    borderRadius: radii.lg,
    borderWidth: 2,
    height: 190,
    left: "10%",
    position: "absolute",
    right: "10%",
    top: "32%",
  },
  scanHint: {
    alignSelf: "center",
    backgroundColor: palette.scrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: "absolute",
    top: "60%",
  },
  scanHintLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  secondaryButton: {
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryButtonLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  subtitle: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
  },
  });
}
