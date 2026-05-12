import { Card, CardBody, CardHeader } from "@heroui/react";
import { Link } from "react-router-dom";

interface WriterPanelProps {
  eyebrow?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  hint?: string;
}

export function WriterPanel({
  eyebrow = "Writer's Desk",
  title = "写作入口",
  description = "直接把新文章写进 Wanderlust。标题、摘要、标签和 Markdown 正文会一起保存，发布后就能在前台阅读。",
  ctaLabel = "开始写新文章",
  hint = "正文支持 Markdown 与 GFM，适合直接贴现成 md 草稿。",
}: WriterPanelProps) {
  return (
    <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
      <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
        <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">{eyebrow}</p>
        <h3 className="display-type text-3xl text-[var(--ink)]">{title}</h3>
      </CardHeader>
      <CardBody className="gap-4 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
        <p>{description}</p>
        <Link
          to="/write"
          className="inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          {ctaLabel}
        </Link>
        <p className="text-xs leading-6 text-[var(--muted)]">{hint}</p>
      </CardBody>
    </Card>
  );
}