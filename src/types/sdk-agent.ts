/** Request body for POST /api/sdk/agents/register */
export interface SdkAgentRegisterBody {
  name?: string;
}

/** Response for POST /api/sdk/agents/register */
export interface SdkAgentRegisterResponse {
  agent_id: string;
  api_key: string;
  claim_code: string;
  claim_url: string;
  wallet_address: string;
  name?: string;
}

/** Public claim info for GET /api/sdk/claim/:claimCode */
export interface SdkClaimInfoResponse {
  claim_code: string;
  status: "UNCLAIMED" | "CLAIMED";
  agent_name?: string;
}

/** Request body for POST /api/sdk/claim/:claimCode (wallet claim) */
export interface SdkClaimSubmitBody {
  address: string;
  signature: string;
  message: string;
}

/** Response for POST /api/sdk/claim/:claimCode */
export interface SdkClaimSubmitResponse {
  success: boolean;
  agent_id?: string;
  user_id?: string;
}
