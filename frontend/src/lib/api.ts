import type { BodyFormat, Post, PostSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

interface WriteAccessResponse {
  message: string;
}

interface BatchPostsResponse {
  message: string;
  affected: number;
}

export interface UploadImageResponse {
  url: string;
  path: string;
  contentType: string;
  bytes: number;
  cached: boolean;
}

export type BatchPostsAction = "publish" | "draft" | "delete";

export interface HTMLImportResponse {
  title: string;
  slug: string;
  summary: string;
  tags: string[];
  author: string;
  publishedAt: string;
  bodyFormat: BodyFormat;
  body: string;
}

export interface PDFExportPayload {
  title: string;
  summary?: string;
  category?: string;
  tags?: string[];
  author?: string;
  publishedAt?: string;
  accent?: string;
  bodyFormat?: BodyFormat;
  body: string;
}

export interface PDFExportResponse {
  blob: Blob;
  fileName: string;
}

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
  bodyFormat?: BodyFormat;
  body: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !hasFormDataBody ? { "Content-Type": "application/json" } : {}),
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

function parseContentDispositionFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return "post.pdf";
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch) {
    return plainMatch[1].trim();
  }

  return "post.pdf";
}

export function fetchPosts(query?: string): Promise<PostSummary[]> {
  const params = new URLSearchParams();
  if (query && query.trim().length > 0) {
    params.set("q", query.trim());
  }

  const path = params.toString() ? `/posts?${params.toString()}` : "/posts";
  return request<PostSummary[]>(path);
}

export function fetchPost(slug: string): Promise<Post> {
  return request<Post>(`/posts/${slug}`);
}

export function fetchAdminPosts(writeToken: string, query?: string, listFilter?: string): Promise<PostSummary[]> {
  const params = new URLSearchParams();
  if (query && query.trim().length > 0) {
    params.set("q", query.trim());
  }

  if (listFilter && listFilter.trim().length > 0) {
    params.set("filter", listFilter.trim());
  }

  const path = params.toString() ? `/admin/posts?${params.toString()}` : "/admin/posts";

  return request<PostSummary[]>(path, {
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

export function uploadImage(file: File, writeToken: string): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.set("file", file);

  return request<UploadImageResponse>("/admin/uploads/images", {
    method: "POST",
    body: formData,
    headers: writeAccessHeaders(writeToken),
  });
}

export function importHTMLDocument(file: File, writeToken: string): Promise<HTMLImportResponse> {
  const formData = new FormData();
  formData.set("file", file);

  return request<HTMLImportResponse>("/admin/imports/html", {
    method: "POST",
    body: formData,
    headers: writeAccessHeaders(writeToken),
  });
}

export async function exportPostPDF(payload: PDFExportPayload, writeToken: string): Promise<PDFExportResponse> {
  const response = await fetch(`${API_BASE}/admin/exports/pdf`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      ...writeAccessHeaders(writeToken),
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `请求失败: ${response.status}`;

    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    fileName: parseContentDispositionFileName(response.headers.get("content-disposition")),
  };
}