/**
 * Compute on-chain questionId for Sub0 createMarket.
 * Matches Solidity: keccak256(abi.encodePacked(question, creator, oracle)).
 */

import { encodePacked, keccak256, getAddress, type Hex } from "viem";

/**
 * Returns the bytes32 questionId used by the Sub0 contract to index markets.
 * Creator and oracle are normalized to checksum addresses.
 */
export function computeQuestionId(
  question: string,
  creator: string,
  oracle: string
): Hex {
  const creatorAddr = getAddress(creator);
  const oracleAddr = getAddress(oracle);
  const packed = encodePacked(
    ["string", "address", "address"],
    [question, creatorAddr, oracleAddr]
  );
  return keccak256(packed);
}
