import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function getEncryptionKey(): Buffer {
  const secret = config.agentEncryptionSecret;
  const salt = Buffer.from("sub0-agent-key-v1", "utf8");
  return scryptSync(secret, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

export interface GeneratedAgentKeys {
  publicKey: string;
  encryptedPrivateKey: string;
}

export function generateAgentKeys(): GeneratedAgentKeys {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const publicKey = account.address;
  const encryptedPrivateKey = encryptPrivateKey(privateKey);
  return { publicKey, encryptedPrivateKey };
}

export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyHex, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64url");
}

export function decryptPrivateKey(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64url");
  if (combined.length < IV_LENGTH + 16 + 1) {
    throw new Error("Invalid encrypted key format");
  }
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = combined.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
