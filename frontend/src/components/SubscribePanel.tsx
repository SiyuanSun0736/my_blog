import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { createSubscription } from "../lib/api";

interface SubscribePanelProps {
  eyebrow?: string;
  title?: string;
  description?: string;
}

export function SubscribePanel({
  eyebrow = "Newsletter",
  title = "订阅更新",
  description = "留下邮箱后，后续文章更新会发送到你的收件箱。",
}: SubscribePanelProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await createSubscription(email.trim());
      setMessage(response.message);
      setEmail("");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "订阅失败，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
      <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
        <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">{eyebrow}</p>
        <h3 className="display-type text-3xl text-[var(--ink)]">{title}</h3>
      </CardHeader>
      <CardBody className="gap-4 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
        <p>{description}</p>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <Input
            aria-label="订阅邮箱"
            type="email"
            placeholder="you@example.com"
            radius="lg"
            value={email}
            onValueChange={setEmail}
          />
          <Button
            type="submit"
            radius="full"
            color="primary"
            isDisabled={submitting || email.trim().length === 0}
          >
            {submitting ? "提交中..." : "订阅更新"}
          </Button>
        </form>

        {message ? (
          <div
            className={
              isError
                ? "rounded-[1.25rem] border border-danger/30 bg-danger-50 px-4 py-3 text-danger-700"
                : "rounded-[1.25rem] border border-success/30 bg-success-50 px-4 py-3 text-success-700"
            }
          >
            {message}
          </div>
        ) : (
          <p className="text-xs leading-6 text-[var(--muted)]">
            目前只保存邮箱地址，用于后续通知，不会展示在站点前台。
          </p>
        )}
      </CardBody>
    </Card>
  );
}