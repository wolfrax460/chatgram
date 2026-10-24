#!/usr/bin/env bash
# Production DB backup + read-only status cleanup count. Run on the VM.
set -euo pipefail
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p ~/chatgram-backups
cd ~/chatgram/server

URI="$(node -e 'require("dotenv").config(); process.stdout.write(process.env.MONGODB_URI)')"

if [ -z "$URI" ]; then
  echo "BACKUP_FAILED no MONGODB_URI"
  exit 1
fi

mongodump --uri="$URI" --out ~/chatgram-backups/$stamp >/tmp/dump.log 2>&1 \
  && tar czf ~/chatgram-backups/$stamp.tgz -C ~/chatgram-backups $stamp \
  || { echo "BACKUP_FAILED"; tail -5 /tmp/dump.log; exit 1; }

echo "BACKUP_OK $stamp $(du -h ~/chatgram-backups/$stamp.tgz | cut -f1)"

# Read-only safety check for the new status cleanup job (before the first boot).
node - <<'EOF'
require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const cut = new Date(Date.now() - 24 * 3600 * 1000);
  const db = mongoose.connection.db;
  const total = await db.collection('statuses').countDocuments({});
  const old = await db.collection('statuses').countDocuments({ createdAt: { $lt: cut } });
  console.log(`STATUSES total=${total} olderThan24h=${old}`);
  await mongoose.disconnect();
}).catch((error) => {
  console.error('STATUS_COUNT_FAILED', error.message);
  process.exit(1);
});
EOF

# Keep a copy of the current API source for rollback.
cp -r src "src.bak-$stamp"
echo "SRC_BACKUP_OK src.bak-$stamp"
