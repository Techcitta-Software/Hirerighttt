# Build from repository root:
#   docker build -f backend/node/Dockerfile .

FROM node:22-alpine AS runtime
WORKDIR /app/backend/node
RUN addgroup -S app && adduser -S app -G app

COPY backend/node/package.json backend/node/package-lock.json ./
RUN npm ci --omit=dev

COPY env /app/env
COPY backend/node/index.mjs backend/node/interviewAgent.mjs backend/node/loadEnv.mjs backend/node/config.mjs backend/node/llmModels.mjs backend/node/geminiClient.mjs ./
COPY backend/node/server ./server
COPY backend/node/routes ./routes
COPY backend/node/db ./db
COPY backend/node/assessment ./assessment
COPY backend/node/vendor ./vendor
COPY backend/node/authPasswords.mjs backend/node/authRegister.mjs backend/node/authRoles.mjs backend/node/authPhone.mjs ./
COPY backend/node/mail.mjs backend/node/mailer.mjs backend/node/interviewInvites.mjs backend/node/resumeStorage.mjs ./

USER app
ENV NODE_ENV=production
ENV ENVIRONMENT=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
