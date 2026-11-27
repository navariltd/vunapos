import {
  getKitchenSigningCertificate,
  signKitchenRequest,
} from "../lib/apiClient";

export type QzSigning = {
  api: { setSha256Type(callback: (message: string) => Promise<string>): void };
  security: {
    setCertificatePromise(
      callback: (resolve: (certificate: string | null) => void) => void,
      options?: { rejectOnFailure: boolean }
    ): void;
    setSignatureAlgorithm(algorithm: string): void;
    setSignaturePromise(
      callback: (
        digest: string
      ) => (
        resolve: (signature: string) => void,
        reject: (error: unknown) => void
      ) => void
    ): void;
  };
};

export async function downloadKitchenTrustCertificate(posProfile: string) {
  const { message } = await getKitchenSigningCertificate(posProfile);
  if (!message.enabled || !message.certificate)
    throw new Error("Signing is not enabled for this site.");
  const url = URL.createObjectURL(
    new Blob([message.certificate], { type: "application/x-x509-ca-cert" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "override.crt";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Capture the full request before QZ hashes it so the server can authorize the
// operation. Never offer an endpoint that blindly signs arbitrary supplied hashes.
export async function configureKitchenSigning(
  qz: QzSigning,
  posProfile: string
) {
  const { message: config } = await getKitchenSigningCertificate(posProfile);
  if (!config.enabled) {
    qz.security.setCertificatePromise((resolve) => resolve(null));
    qz.security.setSignaturePromise(() => (resolve) => resolve(""));
    return;
  }
  if (!config.certificate)
    throw new Error("The kitchen signing certificate is missing.");
  const pending = new Map<string, string>();
  qz.api.setSha256Type(async (message) => {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(message)
    );
    const digest = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    pending.set(digest, message);
    if (pending.size > 100) pending.delete(pending.keys().next().value!);
    return digest;
  });
  qz.security.setCertificatePromise((resolve) => resolve(config.certificate), {
    rejectOnFailure: true,
  });
  qz.security.setSignatureAlgorithm("SHA512");
  // QZ wraps non-AsyncFunction callbacks with new Promise(factory(digest)).
  // Use its resolver-factory contract explicitly: minifiers can turn an async
  // callback into a normal function returning a Promise and break that detection.
  qz.security.setSignaturePromise((digest) => (resolve, reject) => {
    const message = pending.get(digest);
    pending.delete(digest);
    if (!message) {
      reject(
        new Error("The printing request could not be verified for signing.")
      );
      return;
    }
    void signKitchenRequest(message, posProfile).then(resolve, reject);
  });
}
