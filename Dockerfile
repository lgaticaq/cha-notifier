FROM lgatica/node-build:10-onbuild@sha256:290b2070768fd69816b629055173cd18a05f739f86e2ce75a93d267a81602386

RUN apk add --no-cache curl

EXPOSE 3000

HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:3000/healthcheck || exit 1
