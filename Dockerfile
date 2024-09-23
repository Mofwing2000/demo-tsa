FROM node:18 AS base

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm install

FROM base AS build

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build:prod

FROM nginx:1.18.0-alpine

COPY --from=build /app/dist /usr/share/nginx/html
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html =404; } }' > /etc/nginx/conf.d/default.conf
CMD ["nginx", "-g", "daemon off;"]