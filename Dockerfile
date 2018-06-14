FROM lgatica/node-build:10-onbuild@sha256:53efef373208086fe25ae222d8e81b092e112ca20cad0212d08199bc6f3f2928

RUN apk add --no-cache curl

EXPOSE 3000

HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:3000/healthcheck || exit 1
