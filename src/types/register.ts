export const AUTH_METHODS = ["WALLET", "SSO", "PASSKEY"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface ChallengePayload {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface RegisterAgentCreate {
  name: string;
  persona: string;
  publicKey: string;
  encryptedPrivateKey: string;
  modelSettings: Record<string, unknown>;
}

export interface RegisterAgentTemplate {
  templateId: string;
  name: string;
  persona?: string;
  publicKey: string;
  encryptedPrivateKey: string;
  modelSettings?: Record<string, unknown>;
}

export type RegisterAgentPayload = { create: RegisterAgentCreate } | { template: RegisterAgentTemplate };

export interface RegisterBody {
  username: string;
  address: string;
  authMethod: AuthMethod;
  verificationMessage: string;
  verificationSignature: string;
  nonce: string;
  delegationMessage?: string;
  delegationSignature?: string;
  agent: RegisterAgentPayload;
  email?: string | null;
}
