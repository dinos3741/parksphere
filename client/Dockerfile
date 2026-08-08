# Builds the CRA static bundle. REACT_APP_SERVER_URL is a build-time ARG because Create React App
# bakes REACT_APP_* vars into the JS bundle at build time, not read at runtime — there's no "restart
# the container to pick up a new value" for this one, a changed URL needs a rebuild.
FROM node:20-alpine AS build
WORKDIR /app
ARG REACT_APP_SERVER_URL
ENV REACT_APP_SERVER_URL=$REACT_APP_SERVER_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Exports the build output into a shared named volume (see docker-compose.prod.yml's client_build
# volume) for Caddy to serve as static files — no nginx/node needed just to host static assets.
FROM alpine:3.20 AS export
COPY --from=build /app/build /export
CMD ["sh", "-c", "rm -rf /output/* && cp -r /export/* /output/"]
