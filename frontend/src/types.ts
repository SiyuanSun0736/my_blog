export type BodyFormat = "markdown" | "html";

export interface SearchSnippet {
  field: string;
  label: string;
  text: string;
  html: string;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  author: string;
  publishedAt: string;
  readMinutes: number;
  draft: boolean;
  featured: boolean;
  accent: string;
  bodyFormat: BodyFormat;
  searchScore?: number;
  searchMode?: "text" | "fuzzy" | string;
  searchSnippet?: SearchSnippet;
}

export interface Post extends PostSummary {
  body: string;
}