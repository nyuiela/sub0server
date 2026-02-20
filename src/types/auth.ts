export type AuthUser = {
  type: "user";
  address: string;
  userId?: string;
};

export type AuthApiKey = {
  type: "apiKey";
};

export type RequestAuth = AuthUser | AuthApiKey | null;
