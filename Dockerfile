FROM node:18.20.4-alpine
FROM ghcr.io/puppeteer/puppeteer:19.7.2
USER root

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install
COPY . .
CMD [ "node", "server.js" ]

