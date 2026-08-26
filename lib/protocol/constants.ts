/** Shared Move/TypeScript outcome codes. Keep this file as the sole TS source. */
export const OUTCOME = {
  NONE: 0,
  YES: 1,
  NO: 2,
  UNSURE: 3,
} as const satisfies { NONE: 0; YES: 1; NO: 2; UNSURE: 3 };

/** Claim results add the terminal UNRESOLVED value to the vote outcomes. */
export const CLAIM_RESULT = {
  NONE: 0,
  YES: 1,
  NO: 2,
  UNSURE: 3,
  UNRESOLVED: 4,
} as const satisfies {
  NONE: 0;
  YES: 1;
  NO: 2;
  UNSURE: 3;
  UNRESOLVED: 4;
};

/** Claim creation modes encoded as Move u8 values. */
export const CLAIM_MODE = {
  DIRECT_REVIEW: 1,
  OPTIMISTIC_SETTLEMENT: 2,
} as const satisfies { DIRECT_REVIEW: 1; OPTIMISTIC_SETTLEMENT: 2 };

/** Full on-chain claim lifecycle encoded as Move u8 values. */
export const CLAIM_STATE = {
  CREATED: 0,
  PROPOSED: 1,
  CHALLENGED: 2,
  REVIEW_REQUESTED: 3,
  COMMIT_1: 4,
  REVEAL_1: 5,
  DISCUSSION: 6,
  COMMIT_2: 7,
  REVEAL_2: 8,
  FINALIZED_UNCHALLENGED: 9,
  FINALIZED_REVIEWED: 10,
  UNRESOLVED: 11,
  CANCELLED: 12,
} as const satisfies {
  CREATED: 0;
  PROPOSED: 1;
  CHALLENGED: 2;
  REVIEW_REQUESTED: 3;
  COMMIT_1: 4;
  REVEAL_1: 5;
  DISCUSSION: 6;
  COMMIT_2: 7;
  REVEAL_2: 8;
  FINALIZED_UNCHALLENGED: 9;
  FINALIZED_REVIEWED: 10;
  UNRESOLVED: 11;
  CANCELLED: 12;
};

export type VoteOutcome =
  | typeof OUTCOME.YES
  | typeof OUTCOME.NO
  | typeof OUTCOME.UNSURE;

export type ClaimMode = (typeof CLAIM_MODE)[keyof typeof CLAIM_MODE];
export type ClaimState = (typeof CLAIM_STATE)[keyof typeof CLAIM_STATE];
