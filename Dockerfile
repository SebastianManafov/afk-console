FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json webpack.pov.cjs ./
COPY src ./src
COPY viewer-client ./viewer-client
COPY scripts ./scripts
COPY public ./public
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
