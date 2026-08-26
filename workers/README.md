### Evidence worker
Polls claims that need a phase-one or phase-two evidence bundle.
Calls `engine.evidenceFreeze` only; retrieval and persistence remain in the engine.
Run with `pnpm tsx workers/evidence-worker.ts` and stop cleanly with SIGINT.

### Inference worker
Polls commit-phase claims whose evidence root is frozen.
Calls `engine.juryRun` and `engine.votesCommit`; invalid runs remain non-votes.
Run with `pnpm tsx workers/inference-worker.ts` and stop cleanly with SIGINT.

### Resolution worker
Polls lifecycle transitions, reveal submission, discussion, and finalization.
Calls only Engine methods and treats unmet on-chain deadlines as retryable work.
Run with `pnpm tsx workers/resolution-worker.ts` and stop cleanly with SIGINT.
