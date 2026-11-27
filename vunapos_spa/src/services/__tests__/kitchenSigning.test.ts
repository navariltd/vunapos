import { beforeEach, expect, it, vi } from "vitest";
import { configureKitchenSigning } from "../kitchenSigning";
import {
  getKitchenSigningCertificate,
  signKitchenRequest,
} from "../../lib/apiClient";

vi.mock("../../lib/apiClient", () => ({
  getKitchenSigningCertificate: vi.fn(),
  signKitchenRequest: vi.fn(),
}));
function fixture() {
  return {
    api: { setSha256Type: vi.fn() },
    security: {
      setCertificatePromise: vi.fn(),
      setSignatureAlgorithm: vi.fn(),
      setSignaturePromise: vi.fn(),
    },
  };
}
beforeEach(() => vi.clearAllMocks());

it("passes the full operation to the server while returning a QZ digest signature", async () => {
  vi.mocked(getKitchenSigningCertificate).mockResolvedValue({
    message: { enabled: true, certificate: "PUBLIC CERTIFICATE" },
  });
  vi.mocked(signKitchenRequest).mockResolvedValue("BASE64 SIGNATURE");
  const qz = fixture();
  await configureKitchenSigning(qz, "Till 1");
  expect(qz.security.setSignatureAlgorithm).toHaveBeenCalledWith("SHA512");
  const resolve = vi.fn();
  qz.security.setCertificatePromise.mock.calls[0][0](resolve);
  expect(resolve).toHaveBeenCalledWith("PUBLIC CERTIFICATE");
  expect(qz.security.setCertificatePromise.mock.calls[0][1]).toEqual({
    rejectOnFailure: true,
  });
  const message = JSON.stringify({
    call: "printers.find",
    params: { query: null },
    timestamp: Date.now(),
  });
  const digest = await qz.api.setSha256Type.mock.calls[0][0](message);
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  const factory = qz.security.setSignaturePromise.mock.calls[0][0];
  const sign = (digest: string) => new Promise<string>(factory(digest));
  await expect(sign(digest)).resolves.toBe("BASE64 SIGNATURE");
  expect(signKitchenRequest).toHaveBeenCalledWith(message, "Till 1");
  await expect(sign("arbitrary digest")).rejects.toThrow(
    "could not be verified"
  );
});

it("keeps unsigned sites unchanged but does not fall back when signing setup fails", async () => {
  const qz = fixture();
  vi.mocked(getKitchenSigningCertificate).mockResolvedValue({
    message: { enabled: false, certificate: null },
  });
  await configureKitchenSigning(qz, "Till 1");
  const resolve = vi.fn();
  qz.security.setCertificatePromise.mock.calls[0][0](resolve);
  expect(resolve).toHaveBeenCalledWith(null);
  expect(qz.api.setSha256Type).not.toHaveBeenCalled();
  // Exercise QZ's real factory contract rather than awaiting the factory itself.
  const unsigned = qz.security.setSignaturePromise.mock.calls[0][0];
  await expect(new Promise<string>(unsigned("digest"))).resolves.toBe("");
  vi.mocked(getKitchenSigningCertificate).mockRejectedValue(
    new Error("invalid key")
  );
  await expect(configureKitchenSigning(fixture(), "Till 1")).rejects.toThrow(
    "invalid key"
  );
});
