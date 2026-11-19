FROM mcr.microsoft.com/playwright@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates python3 libicu74 liblttng-ust1t64 libkrb5-3 zlib1g \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz -o /tmp/runner.tgz \
    && echo 'baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40  /tmp/runner.tgz' | sha256sum -c - \
    && mkdir /opt/actions-runner && tar -xzf /tmp/runner.tgz -C /opt/actions-runner && rm /tmp/runner.tgz
RUN curl -fsSL --retry 3 https://github.com/theseus-rs/postgresql-binaries/releases/download/17.12.0/postgresql-17.12.0-x86_64-unknown-linux-gnu.tar.gz -o /tmp/postgres.tgz \
    && echo 'af316b6e42266ec0a153bdc9194e0b1b5f12c9ce4f0b13d9a96dfca77d9aaecc  /tmp/postgres.tgz' | sha256sum -c - \
    && mkdir /opt/postgres && tar -xzf /tmp/postgres.tgz -C /opt/postgres && rm /tmp/postgres.tgz \
    && ln -s "$(dirname "$(find /opt/postgres -type f -name pg_ctl)")" /opt/pg-bin \
    && ln -s "$(dirname "$(readlink -f /opt/pg-bin)")/lib" /opt/pg-lib
RUN npm install --global corepack@0.35.0 \
    && useradd --uid 10001 --create-home --shell /bin/bash runner \
    && mkdir -p /home/runner/.cache /home/runner/.npm-global /home/runner/tools \
    && ln -s /ms-playwright /home/runner/.cache/ms-playwright \
    && chown -R 10001:10001 /home/runner /opt/actions-runner
COPY postgres-hook.py /opt/helios-ci/postgres-hook.py
COPY job-started.sh job-database.sh job-completed.sh entrypoint.sh /opt/helios-ci/
RUN chmod 755 /opt/helios-ci/*.sh && touch /opt/helios-ci/isolated-runner
ENV HOME=/home/runner \
    RUNNER_TOOL_CACHE=/home/runner/tools \
    NPM_CONFIG_PREFIX=/home/runner/.npm-global \
    PATH=/home/runner/.npm-global/bin:/opt/pg-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LD_LIBRARY_PATH=/opt/pg-lib \
    ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/helios-ci/job-started.sh \
    ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/helios-ci/job-completed.sh
USER 10001:10001
WORKDIR /opt/actions-runner
ENTRYPOINT ["/opt/helios-ci/entrypoint.sh"]
