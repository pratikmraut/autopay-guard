FROM node:26.7.0-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN pnpm --dir apps/web build

FROM node:26.7.0-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone server needs only the Node runtime. Keep Alpine patched and
# remove build-time package managers (and their dependency trees) from the
# production image.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/raw-request-gate.mjs ./apps/web/raw-request-gate.mjs
COPY --from=build --chown=node:node /workspace/apps/web/src/lib/bff-raw-url.mjs ./apps/web/src/lib/bff-raw-url.mjs

WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "raw-request-gate.mjs", "standalone"]
