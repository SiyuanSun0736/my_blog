import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { BodyFormat } from "../types";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface PostContentProps {
  body: string;
  bodyFormat?: BodyFormat;
  className?: string;
}

export function PostContent({ body, bodyFormat = "markdown", className }: PostContentProps) {
  if (bodyFormat === "html") {
    return <div className={cn("story-prose", className)} dangerouslySetInnerHTML={{ __html: body }} />;
  }

  return (
    <div className={cn("story-prose", className)}>
      <ReactMarkdown rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath, remarkGfm]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}