// Fix the chatgram.qd.je vhost: a single HTTP->HTTPS 301, explicit sitemap and
// robots content types, and charset handling. Idempotent, newline-agnostic.
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'deploy/nginx/chatgram.qd.je.conf';
let s = readFileSync(p, 'utf8');
const NL = s.includes('\r\n') ? '\r\n' : '\n';
const lines = (...parts) => parts.join(NL);

/* 1. Replace certbot's broken :80 block (it lost its listen/server_name lines, so
      port 80 fell through to the duckdns default server and answered 404). */
const certbotIf = s.indexOf('if ($host = chatgram.qd.je)');
if (certbotIf > 0) {
  const blockStart = s.lastIndexOf('server {', certbotIf);
  if (blockStart < 0) throw new Error('could not find the server block around certbot if');
  s =
    s.slice(0, blockStart) +
    lines(
      'server {',
      '    # Plain HTTP: exactly one 301 to the canonical HTTPS origin, with the',
      '    # path and query preserved. Written explicitly instead of the certbot',
      '    # block, which lost its listen/server_name lines and answered 404.',
      '    listen 80;',
      '    listen [::]:80;',
      '    server_name chatgram.qd.je www.chatgram.qd.je;',
      '    return 301 https://chatgram.qd.je$request_uri;',
      '}',
      '',
    );
} else if (!s.includes('return 301 https://chatgram.qd.je$request_uri')) {
  throw new Error('neither certbot block nor a redirect block found');
}

/* 2. Charset handling for XML and plain text, next to the gzip settings. */
if (!s.includes('charset_types')) {
  s = s.replace(/^([ \t]*)gzip_types [^;]+;$/m, (match) =>
    [
      match,
      '',
      '    # Send an explicit charset with XML and plain text (sitemap.xml, robots.txt).',
      '    charset utf-8;',
      '    charset_types text/xml application/xml text/plain application/json;',
    ].join(NL),
  );
}

/* 3. Exact locations so /sitemap.xml is application/xml and /robots.txt is
      text/plain, with the same security headers as every other location
      (add_header does not inherit once a location declares one). */
if (!s.includes('location = /sitemap.xml')) {
  const headers = [
    '        add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)" always;',
    '        add_header Strict-Transport-Security "max-age=31536000" always;',
    '        add_header X-Content-Type-Options "nosniff" always;',
    '        add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  ];
  const block = [
    '    # --- crawler files: explicit content types, no wrapper, no BOM --------',
    '    location = /sitemap.xml {',
    ...headers,
    '        types { application/xml xml; }',
    '        default_type application/xml;',
    '        try_files /sitemap.xml =404;',
    '    }',
    '    location = /robots.txt {',
    ...headers,
    '        types { text/plain txt; }',
    '        default_type text/plain;',
    '        try_files /robots.txt =404;',
    '    }',
    '',
  ].join(NL);
  const match = s.match(/^([ \t]*)location \/ \{$/m);
  if (!match) throw new Error('root location block not found');
  const at = match.index;
  s = s.slice(0, at) + block + s.slice(at);
}

writeFileSync(p, s);
console.log('301 block:', (s.match(/return 301 https:\/\/chatgram\.qd\.je\$request_uri/g) || []).length);
console.log('charset_types:', s.includes('charset_types'));
console.log('sitemap location:', s.includes('location = /sitemap.xml'));
console.log('robots location:', s.includes('location = /robots.txt'));
console.log('server blocks:', (s.match(/^server \{/gm) || []).length);
