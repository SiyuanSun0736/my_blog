import { Card, CardBody, CardHeader, Chip } from "./ui";
import { Link } from "react-router-dom";
import type { PostSummary } from "../types";
import { renderHighlightedText } from "../lib/searchHighlight";

interface PostCardProps {
  post: PostSummary;
  highlightQuery?: string;
}

export function PostCard({ post, highlightQuery }: PostCardProps) {
  const formattedSearchScore =
    typeof post.searchScore === "number"
      ? post.searchScore >= 10
        ? post.searchScore.toFixed(1)
        : post.searchScore.toFixed(2)
      : null;

  return (
    <Card className="glass-panel overflow-hidden border border-black/10 shadow-[0_24px_80px_rgba(75,54,34,0.08)]">
      <div className="h-2 w-full" style={{ background: post.accent }} />
      <CardHeader className="flex flex-col items-start gap-3 px-5 pb-0 pt-5">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Wanderlust Notes</p>
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            {post.category} · {post.publishedAt} · {post.readMinutes} 分钟阅读
          </p>
          <h2 className="display-type mt-3 text-2xl leading-tight text-[var(--ink)]">
            {renderHighlightedText(post.title, highlightQuery)}
          </h2>
        </div>
      </CardHeader>
      <CardBody className="px-5 pb-5 pt-4 text-[var(--muted)]">
        <p className="text-sm leading-7">{renderHighlightedText(post.summary, highlightQuery)}</p>

        {post.searchSnippet ? (
          <div className="mt-4 rounded-[1rem] border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs leading-6 text-amber-900">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="bordered">匹配于 {post.searchSnippet.label}</Chip>
              {post.searchMode ? <Chip size="sm" variant="bordered">{post.searchMode === "text" ? "全文" : "模糊"}</Chip> : null}
              {formattedSearchScore ? <Chip size="sm" color="warning" variant="flat">相关度 {formattedSearchScore}</Chip> : null}
            </div>
            <p
              className="mt-2 [&_mark]:rounded [&_mark]:bg-amber-200 [&_mark]:px-1"
              dangerouslySetInnerHTML={{ __html: post.searchSnippet.html }}
            />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {post.featured ? (
            <Chip size="sm" variant="bordered" color="warning">
              编辑精选
            </Chip>
          ) : null}
          <Chip size="sm" variant="flat" color="secondary">
            {post.author}
          </Chip>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <Chip key={tag} size="sm" variant="light">
              #{tag}
            </Chip>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-black/10 pt-4">
          <span className="text-sm font-medium text-[var(--ink)]">打开这条记录</span>
          <Link
            to={`/posts/${post.slug}`}
            className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
          >
            进入正文
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}