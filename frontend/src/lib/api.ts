import type { Post, PostSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

interface WriteAccessResponse {
  message: string;
}

interface BatchPostsResponse {
  message: string;
  affected: number;
}

export type BatchPostsAction = "publish" | "draft" | "delete";

export interface CreatePostPayload {
  slug?: string;
  title: string;
  summary?: string;
  category?: string;
  tags?: string[];
  author?: string;
  publishedAt?: string;
  draft?: boolean;
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

export function fetchAdminPosts(writeToken: string): Promise<PostSummary[]> {
  return request<PostSummary[]>("/admin/posts", {
    headers: writeAccessHeaders(writeToken),
  });
}

export function fetchAdminPost(slug: string, writeToken: string): Promise<Post> {
  return request<Post>(`/admin/posts/${slug}`, {
    headers: writeAccessHeaders(writeToken),
  });
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

export function updatePost(slug: string, payload: CreatePostPayload, writeToken: string): Promise<Post> {
  return request<Post>(`/posts/${slug}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: writeAccessHeaders(writeToken),
  });
}

export function deletePost(slug: string, writeToken: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/posts/${slug}`, {
    method: "DELETE",
    headers: writeAccessHeaders(writeToken),
  });
}

export function setPostFeatured(slug: string, featured: boolean, writeToken: string): Promise<Post> {
  return request<Post>(`/posts/${slug}/featured`, {
    method: "PATCH",
    body: JSON.stringify({ featured }),
    headers: writeAccessHeaders(writeToken),
  });
}

export function batchPosts(
  action: BatchPostsAction,
  slugs: string[],
  writeToken: string,
): Promise<BatchPostsResponse> {
  return request<BatchPostsResponse>("/admin/posts/batch", {
    method: "POST",
    body: JSON.stringify({ action, slugs }),
    headers: writeAccessHeaders(writeToken),
  });
}