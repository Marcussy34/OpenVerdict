# Universal production image (Fly.io / Render / Railway-dockerfile / any VPS).
# One container runs the Next.js observer plus the three engine workers via
# scripts/start-production.mjs (any child death exits the container so the
# platform restarts it atomically).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Next.js bakes NEXT_PUBLIC_* values at build time; Railway only exposes
# service variables to a Dockerfile build through ARG, so declare them here.
ARG NEXT_PUBLIC_ENOKI_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_SUI_NETWORK=testnet
# Two hosts, one build: the landing origin and the console origin (the header
# hand-off and the client bundles read these; the proxy reads them at runtime).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
# The documentation origin (docs.openverdict.info). Unset keeps the docs
# in-app at /docs, so the same build serves a one-host deployment.
ARG NEXT_PUBLIC_DOCS_URL
ENV NEXT_PUBLIC_ENOKI_API_KEY=$NEXT_PUBLIC_ENOKI_API_KEY \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_SUI_NETWORK=$NEXT_PUBLIC_SUI_NETWORK \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
