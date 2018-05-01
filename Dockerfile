FROM lgatica/node-build:10-onbuild@sha256:1b40c4bc1c4f48abe81e4e1a54255cfc386bb64030ebe76e21d7d8557468281d

RUN apk add --no-cache curl

EXPOSE 3000

HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:3000/healthcheck || exit 1
