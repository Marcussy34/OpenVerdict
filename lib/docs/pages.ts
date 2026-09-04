/**
 * The documentation site's content layer.
 *
 * Pages are Markdown files under `docs/site/`, one per route, with a small
 * YAML front matter block (title, description, order, optional source). Two
 * rules keep the docs from drifting:
 *
 *  - a page with `source:` renders that repository file straight from disk,
 *    so docs/API.md and AGENTS.md have exactly one copy each;
 *  - `{{token}}` in a page body is replaced from config/release.testnet.json,
 *    so no package id is ever typed into prose.
 *
 * Reads happen on the server (request time, cached per process) and never in
 * the browser.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import GithubSlugger from "github-slugger";

/** Where the page sources live, relative to the repository root. */
const SITE_DIR = "docs/site";

/** Repository blob base: relative links inside a rendered file point here. */
const REPO_BLOB_BASE = "https://github.com/Marcussy34/OpenVerdict/blob/main/";

/** The deployment the contracts page describes. */
const RELEASE_MANIFEST_PATH = "config/release.testnet.json";

export type DocHeading = {
  /** 2 for a section, 3 for a subsection. */
  depth: number;
  text: string;
  /** Matches the id rehype-slug puts on the rendered heading. */
  id: string;
};

export type DocPage = {
  /** Route slug, empty string for the index. */
  slug: string;
  title: string;
  /** The sidebar label, when the full title is too long for the rail. */
  navTitle: string;
  description: string;
  order: number;
  /** Markdown ready to render: tokens substituted, any source file appended. */
  body: string;
  /** The repository file this page renders, when it renders one. */
  source: string | null;
  headings: DocHeading[];
};

/** Just enough of a page to draw the sidebar. */
export type DocPageSummary = Pick<
  DocPage,
  "slug" | "title" | "navTitle" | "description" | "order"
>;

// One read per process: the files are static for the life of a deployment.
// Development re-reads every request, because editing a Markdown file
// invalidates no module and the page would otherwise serve the old text.
let pagesPromise: Promise<DocPage[]> | null = null;

/** Every page, in front-matter order. */
export function loadDocPages(): Promise<DocPage[]> {
  if (process.env.NODE_ENV !== "production") return readAllPages();
  pagesPromise ??= readAllPages();
  return pagesPromise;
}

/** The sidebar list. */
export async function loadDocNav(): Promise<DocPageSummary[]> {
  const pages = await loadDocPages();
  return pages.map(({ slug, title, navTitle, description, order }) => ({
    slug,
    title,
    navTitle,
    description,
    order,
  }));
}

/** One page by slug, or null when the route does not exist. */
export async function loadDocPage(slug: string): Promise<DocPage | null> {
  const pages = await loadDocPages();
  return pages.find((page) => page.slug === slug) ?? null;
}

async function readAllPages(): Promise<DocPage[]> {
  const root = process.cwd();
  const dir = path.join(root, SITE_DIR);
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".md"))
    .sort();
  const tokens = await readReleaseTokens(root);
  const pages = await Promise.all(
    files.map((name) => readPage(root, dir, name, tokens)),
  );
  return pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

async function readPage(
  root: string,
  dir: string,
  fileName: string,
  tokens: Record<string, string>,
): Promise<DocPage> {
  const raw = await readFile(path.join(dir, fileName), "utf8");
  const { data, content } = parseFrontMatter(raw);
  const slug = fileName === "index.md" ? "" : fileName.replace(/\.md$/, "");
  const source = data.source ?? null;

  let body = substituteTokens(content, tokens).trimEnd();
  if (source) {
    const rendered = await readSourceFile(root, source);
    body = `${body}\n\n${rendered}`.trim();
  }

  const title = data.title ?? (slug || "Documentation");
  return {
    slug,
    title,
    navTitle: data.navTitle ?? title,
    description: data.description ?? "",
    order: Number(data.order ?? 999),
    body,
    source,
    headings: extractHeadings(body),
  };
}

/**
 * A repository file, made safe to render inside a docs page: its own H1 goes
 * (the page already has one) and every relative link becomes a repository
 * link, since ../lib/engine/contract.ts means nothing to a browser here.
 */
async function readSourceFile(root: string, source: string): Promise<string> {
  const raw = await readFile(path.join(root, source), "utf8");
  const { content } = parseFrontMatter(raw);
  return rewriteRelativeLinks(dropLeadingH1(content), path.posix.dirname(source));
}

// --- front matter -----------------------------------------------------------

type FrontMatter = {
  title?: string;
  navTitle?: string;
  description?: string;
  order?: string;
  source?: string;
};

/**
 * A deliberately small front matter parser: the docs only ever use flat
 * `key: value` string pairs, so a YAML dependency would buy nothing.
 */
export function parseFrontMatter(raw: string): {
  data: FrontMatter;
  content: string;
} {
  const normalized = raw.replace(/^﻿/, "");
  if (!normalized.startsWith("---\n")) return { data: {}, content: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { data: {}, content: normalized };

  const block = normalized.slice(4, end);
  const content = normalized.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (!key) continue;
    data[key] = unquote((value ?? "").trim());
  }
  return { data, content };
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

// --- release tokens ---------------------------------------------------------

/**
 * Build-time values from the release manifest, so the contracts page can never
 * cite a stale package id. Missing keys resolve to "not deployed" rather than
 * leaving a raw token in the prose.
 */
async function readReleaseTokens(root: string): Promise<Record<string, string>> {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, RELEASE_MANIFEST_PATH), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    // A checkout without a release file still builds; the page says so.
  }

  const text = (key: string): string => {
    const value = manifest[key];
    return typeof value === "string" && value.length > 0 ? value : "not deployed";
  };
  const nested = (group: string, key: string): string => {
    const parent = manifest[group];
    if (!parent || typeof parent !== "object") return "not deployed";
    const value = (parent as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.join(", ");
    return "not deployed";
  };

  const network = text("network");
  const explorer = (id: string) =>
    id.startsWith("0x")
      ? `https://suiscan.xyz/${network}/object/${id}`
      : "https://suiscan.xyz/testnet";

  const sealKeyServers = ((): string => {
    const seal = manifest.seal;
    if (!seal || typeof seal !== "object") return "not deployed";
    const servers = (seal as Record<string, unknown>).keyServers;
    return Array.isArray(servers) ? String(servers.length) : "not deployed";
  })();

  const tokens: Record<string, string> = {
    network,
    packageId: text("packageId"),
    originalPackageId: text("originalPackageId"),
    registryObjectId: text("registryObjectId"),
    coinType: text("coinType"),
    suiRpcUrl: text("suiRpcUrl"),
    clockObjectId: text("clockObjectId"),
    randomObjectId: text("randomObjectId"),
    explorerTxTemplate: text("explorerTxTemplate"),
    sealPackageId: nested("seal", "packageId"),
    sealThreshold: nested("seal", "threshold"),
    sealKeyServers,
    gonkaBaseUrl: nested("gonka", "baseUrl"),
    gonkaModels: nested("gonka", "models"),
    walrusMode: nested("walrus", "mode"),
    walrusEpochs: nested("walrus", "epochs"),
    committeeSize: nested("committee", "size"),
    committeeThreshold: nested("committee", "threshold"),
    maxSeatsPerModel: nested("committee", "maxSeatsPerModel"),
    minDistinctModels: nested("committee", "minDistinctModels"),
  };
  tokens.packageUrl = explorer(tokens.packageId ?? "");
  tokens.originalPackageUrl = explorer(tokens.originalPackageId ?? "");
  tokens.registryUrl = explorer(tokens.registryObjectId ?? "");
  tokens.sealPackageUrl = explorer(tokens.sealPackageId ?? "");
  return tokens;
}

function substituteTokens(
  content: string,
  tokens: Record<string, string>,
): string {
  return content.replace(/\{\{([A-Za-z][\w]*)\}\}/g, (whole, key: string) =>
    key in tokens ? (tokens[key] as string) : whole,
  );
}

// --- markdown helpers -------------------------------------------------------

/** Drops a rendered file's own H1 so the page keeps exactly one. */
function dropLeadingH1(content: string): string {
  return content.replace(/^\s*#\s+[^\n]*\n+/, "");
}

/**
 * Rewrites `](./x)` and `](../x)` targets to repository links, resolved
 * against the directory the rendered file lives in.
 */
function rewriteRelativeLinks(content: string, sourceDir: string): string {
  return content.replace(
    /\]\((?!https?:|mailto:|#|\/)([^)\s]+)([^)]*)\)/g,
    (whole, target: string, tail: string) => {
      if (target.startsWith("<")) return whole;
      const [pathPart, hash = ""] = splitHash(target);
      if (!pathPart) return whole;
      const resolved = path.posix
        .normalize(path.posix.join(sourceDir === "." ? "" : sourceDir, pathPart))
        .replace(/^\.\//, "");
      if (resolved.startsWith("..")) return whole;
      return `](${REPO_BLOB_BASE}${resolved}${hash}${tail})`;
    },
  );
}

function splitHash(target: string): [string, string] {
  const at = target.indexOf("#");
  return at === -1 ? [target, ""] : [target.slice(0, at), target.slice(at)];
}

/**
 * The "on this page" rail. Slugs are produced by github-slugger in document
 * order, which is exactly what rehype-slug does, so every anchor resolves.
 */
export function extractHeadings(markdown: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const headings: DocHeading[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const depth = match[1]?.length ?? 0;
    const text = plainText(match[2] ?? "");
    // rehype-slug slugs every heading, so the slugger must see them all even
    // though only h2 and h3 reach the rail.
    const id = slugger.slug(text);
    if (depth === 2 || depth === 3) headings.push({ depth, text, id });
  }
  return headings;
}

/** Heading text as the renderer will produce it: no markdown, just words. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}
