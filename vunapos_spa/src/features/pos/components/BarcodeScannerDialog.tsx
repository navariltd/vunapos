import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

type BarcodeScannerDialogProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
};

function getDetectorConstructor(): BarcodeDetectorConstructor | undefined {
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
}

export function BarcodeScannerDialog({
  open,
  onClose,
  onDetected,
}: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const detectorConstructor = getDetectorConstructor();
    if (!detectorConstructor) {
      queueMicrotask(
        () =>
          active &&
          setError(
            "Camera barcode scanning is not supported in this browser. Use the scanner input instead.",
          ),
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(
        () =>
          active &&
          setError(
            "Camera access is unavailable. Use a secure connection or the scanner input instead.",
          ),
      );
      return;
    }

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new detectorConstructor({
          formats: [
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "code_128",
            "code_39",
            "qr_code",
          ],
        });
        const scan = async () => {
          if (!active || !videoRef.current) return;
          try {
            const detected = await detector.detect(videoRef.current);
            const barcode = detected
              .find((item) => item.rawValue?.trim())
              ?.rawValue?.trim();
            if (barcode) {
              onDetected(barcode);
              onClose();
              return;
            }
          } catch {
            setError(
              "The camera could not read this barcode. Hold it steady and try again.",
            );
          }
          frameRef.current = requestAnimationFrame(() => void scan());
        };
        void scan();
      } catch (captureError) {
        if (active) {
          setError(
            captureError instanceof DOMException &&
              captureError.name === "NotAllowedError"
              ? "Camera permission was denied. Use the scanner input instead."
              : "The camera could not be opened. Use the scanner input instead.",
          );
        }
      }
    };
    void start();

    return () => {
      active = false;
      if (frameRef.current !== undefined)
        cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [onClose, onDetected, open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan barcode"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="size-5 text-primary" />
            <h2 className="font-semibold">Scan barcode</h2>
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container"
            onClick={onClose}
            aria-label="Close scanner"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {error ? (
            <p className="rounded-md bg-error-container p-3 text-sm text-on-error-container">
              {error}
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">
              Point the camera at an item, batch, or serial barcode.
            </p>
          )}
          <video
            ref={videoRef}
            className="aspect-video w-full rounded-lg bg-black object-cover"
            muted
            playsInline
          />
        </div>
      </div>
    </div>
  );
}
