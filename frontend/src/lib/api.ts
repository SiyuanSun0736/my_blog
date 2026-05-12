import type { Post, PostSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface SubscriptionResponse {
  email: string;
  created: boolean;
  message: string;
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

export function fetchPosts(): Promise<PostSummary[]> {
  return request<PostSummary[]>("/posts");
}

export function fetchPost(slug: string): Promise<Post> {
  return request<Post>(`/posts/${slug}`);
}

export function createSubscription(email: string): Promise<SubscriptionResponse> {
  return request<SubscriptionResponse>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}