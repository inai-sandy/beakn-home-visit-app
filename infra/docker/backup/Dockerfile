# beakn-postgres-backup: tiny alpine image that runs pg_dump under cron.
# Joins mcp-network alongside beakn-postgres, dumps daily at 02:00 IST,
# writes gzipped SQL to the beakn-postgres-backups Docker volume.

FROM alpine:3.20

# postgresql16-client gives us pg_dump matching the server version.
# Cron comes from busybox (already in the alpine base) — dcron crashes
# as PID 1 in containers with "setpgid: Operation not permitted".
# tzdata lets us set Asia/Kolkata so the 02:00 IST schedule is honoured
# without doing UTC math in the crontab.
RUN apk add --no-cache \
        postgresql16-client \
        tzdata \
        coreutils \
        gzip \
        bash

ENV TZ=Asia/Kolkata
RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && echo "$TZ" > /etc/timezone

# Backup destination — overridden at run time via -v beakn-postgres-backups:/backups.
RUN mkdir -p /backups

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# crontab: 02:00 every day, output goes to PID 1's stderr (docker logs).
# PATH must be set in the crontab itself because cron strips the environment.
# busybox crond reads from /var/spool/cron/crontabs/root by default.
COPY crontab /var/spool/cron/crontabs/root
RUN chmod 600 /var/spool/cron/crontabs/root

# busybox crond flags:
#   -f          foreground (keeps the container alive)
#   -l 8        log level 8 (info+) — runs every fired job to syslog/stderr
#   -L /dev/stderr  redirect cron's own log to stderr (visible in docker logs)
CMD ["crond", "-f", "-l", "8", "-L", "/dev/stderr"]
