export class EngineError extends Error {
  override readonly name: string = "EngineError";
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export class ClaimNotFoundError extends EngineError {
  override readonly name = "ClaimNotFoundError";

  constructor(claimId: string) {
    super("CLAIM_NOT_FOUND", `claim was not found: ${claimId}`);
  }
}

export class EngineStateError extends EngineError {
  override readonly name: string = "EngineStateError";

  constructor(message: string) {
    super("INVALID_CLAIM_STATE", message);
  }
}

export class EngineNoEvidenceError extends EngineStateError {
  override readonly name = "EngineNoEvidenceError";

  constructor() {
    super("evidence cannot be frozen without an accepted artifact");
  }
}

export class EngineValidationError extends EngineError {
  override readonly name = "EngineValidationError";

  constructor(message: string) {
    super("VALIDATION_ERROR", message);
  }
}

/** Every operational signing slot is taken; the route answers 409. */
export class EngineCapacityError extends EngineError {
  override readonly name = "EngineCapacityError";

  constructor(message: string) {
    super("SLOTS_EXHAUSTED", message);
  }
}

/** The reservation is unknown or its 15 minute window closed; 404. */
export class StakeReservationNotFoundError extends EngineError {
  override readonly name = "StakeReservationNotFoundError";

  constructor(reservationId: string) {
    super(
      "STAKE_RESERVATION_NOT_FOUND",
      `stake reservation was not found or has expired: ${reservationId}`,
    );
  }
}

/** The chain could not be read (endpoint down, digest not indexed); 502. */
export class ChainReadError extends EngineError {
  override readonly name = "ChainReadError";

  constructor(message: string, options?: ErrorOptions) {
    super("CHAIN_READ_FAILED", message, options);
  }
}

export class ZkLoginVerificationError extends EngineError {
  override readonly name = "ZkLoginVerificationError";

  constructor(message: string, options?: ErrorOptions) {
    super("ZKLOGIN_VERIFICATION_UNAVAILABLE", message, options);
  }
}
