## Blog HTTPS fallback sink

Date: 2026-05-18

This repo did not need a functional rollback for the abandoned `node.wanderlust0736.top` plan.

Current live role:

- `blog-web` still exposes HTTPS only on `127.0.0.1:8444`.
- That local HTTPS listener is now used as the Xray REALITY fallback sink for invalid probe traffic.
- No extra `node.wanderlust0736.top` SAN or nginx vhost is required for the current live setup.

Relevant validation:

- `curl -sk --resolve www.microsoft.com:8444:127.0.0.1 https://www.microsoft.com:8444/ | head`
  returned the blog HTML.
- `curl -sk https://wanderlust0736.top/nginx-healthz`
  stayed healthy after the 3x-ui change.

Operational note:

The fallback page is the normal blog site, but the certificate served on this path is still the blog certificate for `wanderlust0736.top`.