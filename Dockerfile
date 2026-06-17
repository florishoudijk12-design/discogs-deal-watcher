# Cloud watcher image. Runs the paced wantlist sweep + the dashboard API in one process.
FROM node:20-alpine

WORKDIR /app

# Install only production deps (nodemailer). engine/discogs/store/server are dep-free.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY engine.js discogs.js store.js mailer.js server.js watcher.js ./

# Persist the rolling history / alert memory / deals across restarts (mount a volume here).
VOLUME /app/state
ENV PORT=8787
EXPOSE 8787

# Secrets come from env (DISCOGS_TOKEN, DISCOGS_USERNAME, GMAIL_USER, GMAIL_APP_PASSWORD,
# MAIL_TO, DASHBOARD_TOKEN). See README "Deploy".
CMD ["node", "watcher.js"]
