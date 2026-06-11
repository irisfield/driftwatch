import { parse } from "node-html-parser";

import type { CorpusConfig } from "./corpus-config.js";

export interface ScrapedDocument {
  sourceUrl: string;
  title: string;
  sectionPath: string;
  rawText: string;
  corpus: string;
  embeddingModel: string;
}

export async function fetchSitemap(sitemapUrl: string, pathFilter = "/docs"): Promise<string[]> {
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`fetchSitemap: HTTP ${String(response.status)} for ${sitemapUrl}`);
  }
  const xml = await response.text();
  const matches = xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi);
  const urls: string[] = [];
  for (const match of matches) {
    const url = match[1];
    if (url !== undefined) {
      urls.push(url);
    }
  }
  return urls.filter((u) => u.includes(pathFilter));
}

export async function fetchDocument(
  url: string,
  corpus: CorpusConfig,
): Promise<ScrapedDocument | undefined> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch {
    return undefined;
  }

  if (!response.ok) {
    return undefined;
  }

  const html = await response.text();
  const root = parse(html);

  for (const el of root.querySelectorAll("script, style, nav, header, footer, [role=navigation]")) {
    el.remove();
  }

  const titleEl = root.querySelector("title");
  let title = titleEl?.text.trim() ?? "";
  title = title.replaceAll(/\s*[|–—-]\s*[^|–—-]+$/g, "").trim();
  if (title === "") {
    title = root.querySelector("h1")?.text.trim() ?? url;
  }

  const parsed = new URL(url);
  const sectionPath = parsed.pathname;

  const mainEl =
    (corpus.contentSelector === undefined ? null : root.querySelector(corpus.contentSelector)) ??
    root.querySelector("main") ??
    root.querySelector("article") ??
    root.querySelector("body");
  const rawText = (mainEl?.text ?? "")
    .replaceAll("\t", " ")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

  if (rawText.length < 50) {
    return undefined;
  }

  return {
    sourceUrl: url,
    title,
    sectionPath,
    rawText,
    corpus: corpus.name,
    embeddingModel: corpus.embeddingModel,
  };
}
