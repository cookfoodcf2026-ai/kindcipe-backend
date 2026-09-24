/**
 * Apple App Store Server API verification — verifies a JWS signed transaction
 * that the client obtains after a successful in-app purchase.
 *
 * The signed transaction is a JWS (JSON Web Signature) whose header carries the
 * certificate chain (`x5c`). We verify:
 *   1. the ES256 signature against the leaf certificate,
 *   2. that the leaf chains up to Apple's root CA,
 *   3. that the payload is an App Transaction / Transaction (`transactionId`,
 *      `productId`, `bundleId`, `expiresDate`).
 *
 * Apple's App Store Root CA certificates:
 *   Apple Root CA - G2  (used by the App Store Server API)
 *   Apple Root CA - G3
 */
import crypto from "crypto";

const APPLE_ROOT_CAS: { name: string; pem: string }[] = [
  {
    name: "Apple Root CA - G3",
    pem: `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`,
  },
];

export interface AppleTransactionPayload {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  expiresDate?: number;
  purchaseDate?: number;
}

/** Decode the base64url payload of a JWS without verifying (for extraction). */
function decodePayload<T>(jws: string): T {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWS");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload) as T;
}

/**
 * Verify a JWS signed transaction.
 * Returns the decoded payload on success, throws on failure.
 */
export function verifySignedTransaction(jws: string): AppleTransactionPayload {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("Invalid signed transaction");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
    alg?: string;
    x5c?: string[];
  };
  if (header.alg !== "ES256") throw new Error("Unsupported algorithm: " + header.alg);
  if (!header.x5c || header.x5c.length === 0) throw new Error("Missing x5c cert chain");

  const [leafB64, ...chainB64] = header.x5c;
  const leaf = new crypto.X509Certificate(Buffer.from(leafB64, "base64"));
  const chain = chainB64.map((c) => new crypto.X509Certificate(Buffer.from(c, "base64")));

  // 1. Verify the JWS signature against the leaf certificate's public key.
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], "base64url");
  const verifier = crypto.createVerify("SHA256");
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(leaf.publicKey, signature);
  if (!ok) throw new Error("JWS signature verification failed");

  // 2. Verify the chain: each cert is signed by the next; the last chains to Apple root.
  let current: crypto.X509Certificate = leaf;
  for (const parent of chain) {
    if (!current.verify(parent.publicKey)) throw new Error("Cert chain broken");
    current = parent;
  }
  const rootCa = APPLE_ROOT_CAS.find((r) => {
    try {
      return current.verify(new crypto.X509Certificate(r.pem).publicKey);
    } catch {
      return false;
    }
  });
  if (!rootCa) throw new Error("Cert chain does not reach Apple root CA");

  // 3. Extract the transaction payload.
  const payload = decodePayload<{
    transactionId?: string;
    originalTransactionId?: string;
    productId?: string;
    bundleId?: string;
    expiresDate?: number;
    purchaseDate?: number;
  }>(jws);

  if (!payload.transactionId || !payload.productId || !payload.bundleId) {
    throw new Error("Missing transaction fields in payload");
  }

  return {
    transactionId: payload.transactionId,
    originalTransactionId: payload.originalTransactionId ?? payload.transactionId,
    productId: payload.productId,
    bundleId: payload.bundleId,
    expiresDate: payload.expiresDate,
    purchaseDate: payload.purchaseDate,
  };
}

/** Is this string a JWS (starts with a base64url segment)? */
export function isSignedTransaction(receipt: string): boolean {
  return receipt.split(".").length === 3;
}