import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { blake2b256 } from "../protocol/hash";
import {
  RETRIEVAL_REJECTION_CODE,
  type EvidenceResolver,
  type ResolvedAddress,
  type RetrievedArtifact,
  type RetrievalDependencies,
  type RetrievalPolicy,
  type RetrievalRejection,
  type RetrievalRejectionCode,
} from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const REQUIRED_IPV4_BLOCKS = [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 8],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
] as const;

const RESERVED_IPV4_BLOCKS = [
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const IPV6_BLOCKS = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["100::", 64],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const;

const ipv4BlockList = new BlockList();
const ipv6BlockList = new BlockList();

for (const [network, prefix] of [
  ...REQUIRED_IPV4_BLOCKS,
  ...RESERVED_IPV4_BLOCKS,
]) {
  ipv4BlockList.addSubnet(network, prefix, "ipv4");
  // IPv4-mapped IPv6 addresses must receive identical classification.
  ipv6BlockList.addSubnet(`::ffff:${network}`, 96 + prefix, "ipv6");
}
for (const [network, prefix] of IPV6_BLOCKS) {
  ipv6BlockList.addSubnet(network, prefix, "ipv6");
}

const defaultResolver: EvidenceResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new Error("DNS lookup returned an unsupported address family");
    }
    return { address: entry.address, family: entry.family };
  });
};

/**
 * Retrieve untrusted evidence without evaluating it.
 *
 * DNS validation followed by ordinary fetch still has a rebinding TOCTOU gap:
 * fetch can resolve a different address after validation. We re-resolve every
 * hop as a best-effort mitigation. Production should pin a validated IP in the
 * transport socket; the installed dependencies do not provide that facility.
 */
export async function retrieveEvidence(
  url: string,
  policy: RetrievalPolicy,
  injected: Partial<RetrievalDependencies> = {},
): Promise<RetrievedArtifact | RetrievalRejection> {
  let policyRejection: RetrievalRejection | undefined;
  try {
    policyRejection = validatePolicy(policy);
  } catch {
    policyRejection = rejection(
      RETRIEVAL_REJECTION_CODE.INVALID_POLICY,
      "retrieval policy could not be read safely",
    );
  }
  if (policyRejection !== undefined) return policyRejection;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("evidence retrieval timed out"));
  }, policy.timeoutMs);

  try {
    const initial = parseUrl(url);
    if ("rejectionCode" in initial) return initial;
    const dependencies: RetrievalDependencies = {
      resolver: injected.resolver ?? defaultResolver,
      fetchImpl: injected.fetchImpl ?? fetch,
    };
    return await retrieveValidated(
      initial,
      policy,
      dependencies,
      controller,
      () => timedOut,
    );
  } catch {
    if (timedOut) return rejection(RETRIEVAL_REJECTION_CODE.TIMEOUT, "timeout");
    return rejection(
      RETRIEVAL_REJECTION_CODE.RETRIEVAL_FAILED,
      safeFailureDetail("unexpected retrieval failure"),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveValidated(
  initialUrl: URL,
  policy: RetrievalPolicy,
  dependencies: RetrievalDependencies,
  controller: AbortController,
  didTimeOut: () => boolean,
): Promise<RetrievedArtifact | RetrievalRejection> {
  const visited = new Set<string>();
  let currentUrl = initialUrl;
  let redirects = 0;

  while (true) {
    const targetRejection = await validateTarget(
      currentUrl,
      dependencies.resolver,
      controller.signal,
      didTimeOut,
    );
    if (targetRejection !== undefined) return targetRejection;
    visited.add(currentUrl.href);

    const response = await fetchHop(
      currentUrl,
      dependencies.fetchImpl,
      controller.signal,
      didTimeOut,
    );
    if ("rejectionCode" in response) return response;

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await cancelBody(response);
      if (location === null) {
        return rejection(
          RETRIEVAL_REJECTION_CODE.INVALID_REDIRECT,
          `HTTP ${response.status} redirect omitted Location`,
        );
      }
      if (redirects >= policy.maxRedirects) {
        return rejection(
          RETRIEVAL_REJECTION_CODE.TOO_MANY_REDIRECTS,
          `redirect limit ${policy.maxRedirects} exceeded`,
        );
      }

      const nextUrl = parseUrl(location, currentUrl);
      if ("rejectionCode" in nextUrl) return nextUrl;
      if (visited.has(nextUrl.href)) {
        return rejection(
          RETRIEVAL_REJECTION_CODE.REDIRECT_LOOP,
          "redirect loop detected",
        );
      }
      redirects += 1;
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      await cancelBody(response);
      return rejection(
        RETRIEVAL_REJECTION_CODE.HTTP_ERROR,
        `upstream returned HTTP ${response.status}`,
      );
    }

    const mimeType = mediaType(response.headers.get("content-type"));
    const allowedMime = new Set(policy.allowedMime.map(mediaType).filter(Boolean));
    if (mimeType.length === 0 || !allowedMime.has(mimeType)) {
      await cancelBody(response);
      return rejection(
        RETRIEVAL_REJECTION_CODE.UNSUPPORTED_MIME_TYPE,
        mimeType.length === 0
          ? "response omitted a supported Content-Type"
          : `unsupported media type: ${mimeType}`,
      );
    }

    if (contentLengthExceeds(response, policy.maxBytes)) {
      await cancelBody(response);
      return rejection(
        RETRIEVAL_REJECTION_CODE.SIZE_LIMIT_EXCEEDED,
        `response exceeds ${policy.maxBytes} bytes`,
      );
    }

    const body = await readBoundedBody(
      response,
      policy.maxBytes,
      controller,
      didTimeOut,
    );
    if ("rejectionCode" in body) return body;

    return {
      httpStatus: response.status,
      finalUrl: currentUrl.href,
      retrievedAt: Date.now(),
      mimeType,
      byteLength: body.byteLength,
      contentHash: blake2b256(body),
      bytes: body,
    };
  }
}

async function validateTarget(
  url: URL,
  resolver: EvidenceResolver,
  signal: AbortSignal,
  didTimeOut: () => boolean,
): Promise<RetrievalRejection | undefined> {
  if (url.protocol !== "https:") {
    return rejection(
      RETRIEVAL_REJECTION_CODE.UNSUPPORTED_SCHEME,
      "only https URLs are permitted",
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.INVALID_URL,
      "URL credentials are not permitted",
    );
  }

  const hostname = normalizedHostname(url.hostname);
  if (hostname.length === 0) {
    return rejection(RETRIEVAL_REJECTION_CODE.INVALID_URL, "URL has no hostname");
  }
  if (isLocalHostname(hostname)) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.DISALLOWED_NETWORK_TARGET,
      "local hostnames are not permitted",
    );
  }

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    const family: 4 | 6 = literalFamily === 4 ? 4 : 6;
    return validateAddress({ address: hostname, family });
  }

  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await withAbort(resolver(hostname), signal);
  } catch {
    if (didTimeOut() || signal.aborted) {
      return rejection(RETRIEVAL_REJECTION_CODE.TIMEOUT, "timeout during DNS lookup");
    }
    return rejection(
      RETRIEVAL_REJECTION_CODE.DNS_RESOLUTION_FAILED,
      safeFailureDetail("DNS lookup failed"),
    );
  }
  if (addresses.length === 0) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.DNS_RESOLUTION_FAILED,
      "DNS lookup returned no addresses",
    );
  }

  for (const address of addresses) {
    const addressRejection = validateAddress(address);
    if (addressRejection !== undefined) return addressRejection;
  }
  return undefined;
}

function validateAddress(
  resolved: ResolvedAddress,
): RetrievalRejection | undefined {
  const actualFamily = isIP(resolved.address);
  if (actualFamily === 0 || actualFamily !== resolved.family) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.DNS_RESOLUTION_FAILED,
      "DNS lookup returned an invalid address",
    );
  }
  const blocked =
    actualFamily === 4
      ? ipv4BlockList.check(resolved.address, "ipv4")
      : ipv6BlockList.check(resolved.address, "ipv6");
  if (blocked) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.DISALLOWED_NETWORK_TARGET,
      "target resolves to a disallowed network range",
    );
  }
  return undefined;
}

async function fetchHop(
  url: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  didTimeOut: () => boolean,
): Promise<Response | RetrievalRejection> {
  try {
    return await withAbort(
      fetchImpl(url, { redirect: "manual", signal }),
      signal,
    );
  } catch {
    if (didTimeOut() || signal.aborted) {
      return rejection(RETRIEVAL_REJECTION_CODE.TIMEOUT, "timeout during fetch");
    }
    return rejection(
      RETRIEVAL_REJECTION_CODE.RETRIEVAL_FAILED,
      safeFailureDetail("fetch failed"),
    );
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
  didTimeOut: () => boolean,
): Promise<Uint8Array | RetrievalRejection> {
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await withAbort(reader.read(), controller.signal);
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maxBytes) {
        controller.abort(new Error("evidence size limit exceeded"));
        await ignoreCancellationError(reader.cancel());
        return rejection(
          RETRIEVAL_REJECTION_CODE.SIZE_LIMIT_EXCEEDED,
          `response exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(result.value);
    }
  } catch {
    if (didTimeOut()) {
      return rejection(RETRIEVAL_REJECTION_CODE.TIMEOUT, "timeout while reading body");
    }
    return rejection(
      RETRIEVAL_REJECTION_CODE.RETRIEVAL_FAILED,
      safeFailureDetail("response body failed"),
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validatePolicy(policy: RetrievalPolicy): RetrievalRejection | undefined {
  if (
    typeof policy !== "object" ||
    policy === null ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < 0 ||
    !Number.isSafeInteger(policy.maxRedirects) ||
    policy.maxRedirects < 0 ||
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs <= 0 ||
    policy.timeoutMs > 2_147_483_647 ||
    !Array.isArray(policy.allowedMime) ||
    policy.allowedMime.some((value) => typeof value !== "string")
  ) {
    return rejection(
      RETRIEVAL_REJECTION_CODE.INVALID_POLICY,
      "retrieval policy contains invalid limits or media types",
    );
  }
  return undefined;
}

function parseUrl(
  value: string,
  base?: URL,
): URL | RetrievalRejection {
  try {
    const parsed = base === undefined ? new URL(value) : new URL(value, base);
    // Fragments do not reach HTTP and must not defeat redirect-loop detection.
    parsed.hash = "";
    return parsed;
  } catch {
    return rejection(
      base === undefined
        ? RETRIEVAL_REJECTION_CODE.INVALID_URL
        : RETRIEVAL_REJECTION_CODE.INVALID_REDIRECT,
      base === undefined ? "URL is invalid" : "redirect Location is invalid",
    );
  }
}

function normalizedHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return withoutBrackets.toLowerCase().replace(/\.+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "localhost.localdomain" ||
    hostname.endsWith(".localhost.localdomain") ||
    hostname === "ip6-localhost" ||
    hostname === "ip6-loopback" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  );
}

function mediaType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function contentLengthExceeds(response: Response, maxBytes: number): boolean {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) > BigInt(maxBytes);
  } catch {
    return false;
  }
}

async function cancelBody(response: Response): Promise<void> {
  if (response.body !== null) {
    await ignoreCancellationError(response.body.cancel());
  }
}

async function ignoreCancellationError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Cancellation is best effort after a terminal rejection.
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, rejectPromise) => {
    const onAbort = (): void => {
      cleanup();
      rejectPromise(signal.reason);
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        rejectPromise(error);
      },
    );
  });
}

function rejection(
  rejectionCode: RetrievalRejectionCode,
  detail: string,
): RetrievalRejection {
  return { rejectionCode, detail };
}

function safeFailureDetail(prefix: string): string {
  // Transport errors can embed credential-bearing URLs; keep details generic.
  return prefix;
}
