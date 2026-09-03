import { toBase64 } from "@mysten/sui/utils";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHINAMI_GAS_ENDPOINT,
  ShinamiGasStationError,
  getShinamiFund,
  readShinamiConfig,
  sponsorWithShinami,
} from "./shinami";

const SENDER = `0x${"ab".repeat(32)}`;
const KIND = new Uint8Array([0, 1, 2, 3, 4]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sponsorResult() {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      txBytes: "dHhCeXRlcw==",
      txDigest: "HvtKY9RwuE7NC4gLauLFPY3h5qepEy8R7aZHnc4gJu6G",
      signature: "c3BvbnNvclNpZw==",
      expireAtTime: 1695267721,
    },
  };
}

describe("readShinamiConfig", () => {
  it("returns null when the access key is absent or blank", () => {
    expect(readShinamiConfig({})).toBeNull();
    expect(readShinamiConfig({ SHINAMI_GAS_ACCESS_KEY: "   " })).toBeNull();
  });

  it("defaults the endpoint and allows an override", () => {
    expect(readShinamiConfig({ SHINAMI_GAS_ACCESS_KEY: "key" })).toEqual({
      accessKey: "key",
      endpoint: DEFAULT_SHINAMI_GAS_ENDPOINT,
    });
    expect(
      readShinamiConfig({
        SHINAMI_GAS_ACCESS_KEY: " key ",
        SHINAMI_GAS_ENDPOINT: "https://api.eu1.shinami.com/sui/gas/v1",
      }),
    ).toEqual({
      accessKey: "key",
      endpoint: "https://api.eu1.shinami.com/sui/gas/v1",
    });
  });
});

describe("sponsorWithShinami", () => {
  it("posts the documented request shape and maps the result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(sponsorResult()));

    const sponsorship = await sponsorWithShinami({
      accessKey: "test-key",
      transactionKind: KIND,
      sender: SENDER,
      gasBudget: 50_000_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(sponsorship).toEqual({
      txBytes: "dHhCeXRlcw==",
      sponsorSignature: "c3BvbnNvclNpZw==",
      txDigest: "HvtKY9RwuE7NC4gLauLFPY3h5qepEy8R7aZHnc4gJu6G",
      expireAtTime: 1695267721,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(DEFAULT_SHINAMI_GAS_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "gas_sponsorTransactionBlock",
      params: [toBase64(KIND), SENDER, 50_000_000],
    });
  });

  it("omits gasBudget so Shinami auto-budgets, and accepts base64 input", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(sponsorResult()));

    await sponsorWithShinami({
      accessKey: "test-key",
      transactionKind: toBase64(KIND),
      sender: SENDER,
      endpoint: "https://api.eu1.shinami.com/sui/gas/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.eu1.shinami.com/sui/gas/v1");
    expect(JSON.parse(init.body).params).toEqual([toBase64(KIND), SENDER]);
  });

  it("surfaces the JSON-RPC error message without the access key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32602, message: "transaction kind uses the gas coin" },
        },
        400,
      ),
    );

    const error = await sponsorWithShinami({
      accessKey: "super-secret-key",
      transactionKind: KIND,
      sender: SENDER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ShinamiGasStationError);
    const shinamiError = error as ShinamiGasStationError;
    expect(shinamiError.code).toBe("SHINAMI_RPC_ERROR");
    expect(shinamiError.message).toBe("transaction kind uses the gas coin");
    expect(shinamiError.status).toBe(400);
    expect(shinamiError.message).not.toContain("super-secret-key");
  });

  it("reports HTTP 401 and HTTP 500 bodies that carry no JSON-RPC error", async () => {
    const unauthorized = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(
      sponsorWithShinami({
        accessKey: "test-key",
        transactionKind: KIND,
        sender: SENDER,
        fetchImpl: unauthorized as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_HTTP_ERROR", status: 401 });

    const serverError = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      sponsorWithShinami({
        accessKey: "test-key",
        transactionKind: KIND,
        sender: SENDER,
        fetchImpl: serverError as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_HTTP_ERROR", status: 500 });
  });

  it("aborts and reports a timeout when the gas station stalls", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    await expect(
      sponsorWithShinami({
        accessKey: "test-key",
        transactionKind: KIND,
        sender: SENDER,
        timeoutMs: 5,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_TIMEOUT" });
  });

  it("refuses to call out when no access key is configured", async () => {
    const fetchImpl = vi.fn();

    await expect(
      sponsorWithShinami({
        accessKey: "  ",
        transactionKind: KIND,
        sender: SENDER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an incomplete sponsorship result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }));

    await expect(
      sponsorWithShinami({
        accessKey: "test-key",
        transactionKind: KIND,
        sender: SENDER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_SPONSOR_FAILED" });
  });
});

describe("getShinamiFund", () => {
  it("requests gas_getFund with no params and normalizes the fund", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          network: "SUI_TESTNET",
          name: "OpenVerdict",
          balance: 4_915_573_880,
          inFlight: 0,
          depositAddress: `0x${"73".repeat(32)}`,
        },
      }),
    );

    const fund = await getShinamiFund({
      accessKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fund).toEqual({
      name: "OpenVerdict",
      network: "SUI_TESTNET",
      balance: 4_915_573_880,
      inFlight: 0,
      depositAddress: `0x${"73".repeat(32)}`,
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "gas_getFund",
      params: [],
    });
  });

  it("keeps a fund without a deposit address readable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          network: "SUI_TESTNET",
          name: "OpenVerdict",
          balance: 1,
          inFlight: 0,
          depositAddress: null,
        },
      }),
    );

    await expect(
      getShinamiFund({
        accessKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ depositAddress: null });
  });
});
