# syntax=docker/dockerfile:1
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Riyadh
WORKDIR /app
# WeasyPrint (server-side PDF, SPEC 2) needs Pango; Noto fonts cover Arabic.
# Packages come over HTTPS; the optional "ca" secret also covers TLS-inspecting proxies here.
RUN --mount=type=secret,id=ca,required=false \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && if [ -f /run/secrets/ca ]; then echo 'Acquire::https::CAInfo "/run/secrets/ca";' > /etc/apt/apt.conf.d/99ca; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca
COPY . .
# Optional build secret "ca": extra CA bundle for networks with a TLS-inspecting proxy.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install --no-cache-dir -e .
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --root-path /api --proxy-headers --forwarded-allow-ips=*"]
