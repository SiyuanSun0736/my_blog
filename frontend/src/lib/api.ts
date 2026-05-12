import type { Post, PostSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

interface WriteAccessResponse {
  message: string;
}

export interface CreatePostPayload {
  slug?: string;
  title: string;
  summary?: string;
  category?: string;
  tags?: string[];
  author?: string;
  publishedAt?: string;
  featured?: boolean;
  accent?: string;
  body: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `请求失败: ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

function writeAccessHeaders(writeToken: string) {
  return {
    Authorization: `Bearer ${writeToken}`,
  };
}

export function fetchPosts(): Promise<PostSummary[]> {
  return request<PostSummary[]>("/posts");
}

export function fetchPost(slug: string): Promise<Post> {
  return request<Post>(`/posts/${slug}`);
}

export function verifyWriteAccess(writeToken: string): Promise<WriteAccessResponse> {
  return request<WriteAccessResponse>("/write-access", {
    headers: writeAccessHeaders(writeToken),
  });
}

export function createPost(payload: CreatePostPayload, writeToken: string): Promise<Post> {
  return request<Post>("/posts", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: writeAccessHeaders(writeToken),
  });
}