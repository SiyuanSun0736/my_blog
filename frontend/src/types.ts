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
  featured: boolean;
  accent: string;
}

export interface Post extends PostSummary {
  body: string[];
}