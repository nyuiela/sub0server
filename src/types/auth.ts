export type AuthUser = {
  type: "user";
  address: string;
  userId?: string;
};

export type AuthApiKey = {
  type: "apiKey";
};

/** BYOA: agent authenticated via SDK api_key (Bearer or x-api-key). */
export type AuthAgent = {
  type: "agent";
  registrationId: string;
  claimedAgentId: string | null;
  claimedUserId: string | null;
  walletAddress: string;
};

export type RequestAuth = AuthUser | AuthApiKey | AuthAgent | null;
