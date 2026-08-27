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
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
