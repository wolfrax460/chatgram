/**
 * Generate REAL media fixtures for the upload / status tests.
 *
 * No ffmpeg with encoders is available here, so this drives the installed
 * Playwright Chromium: a canvas animation is recorded with MediaRecorder into a
 * playable .webm, and an oscillator is recorded into a playable audio .webm.
 * A PNG is drawn on the canvas and saved.
 *
 *   node tests/e2e/fixtures/generate-fixtures.js
 *
 * Idempotent: existing files are overwritten.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const OUT = __dirname;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');

  // ------------------------------------------------------------- PNG image
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, '#0b6e4f');
    gradient.addColorStop(1, '#25d366');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chatgram status', 320, 190);
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'status-image.png'), Buffer.from(png.split(',')[1], 'base64'));

  // ------------------------------------------------------ video (webm/VP9)
  const videoBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const chunks = [];
    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const done = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    const started = performance.now();
    await new Promise((resolve) => {
      function draw() {
        const t = (performance.now() - started) / 1000;
        ctx.fillStyle = '#0b141a';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#25d366';
        ctx.beginPath();
        ctx.arc(160 + Math.sin(t * 3) * 70, 120, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('status video', 160, 210);
        if (t < 3) requestAnimationFrame(draw);
        else resolve();
      }
      draw();
    });
    recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  fs.writeFileSync(path.join(OUT, 'status-video.webm'), Buffer.from(videoBase64, 'base64'));

  // ------------------------------------------------------ audio (webm/Opus)
  const audioBase64 = await page.evaluate(async () => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    const gain = context.createGain();
    gain.gain.value = 0.25;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();

    const chunks = [];
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm'];
    const mime = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'audio/webm';
    const recorder = new MediaRecorder(destination.stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const done = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    oscillator.stop();
    recorder.stop();
    await done;
    await context.close();
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  fs.writeFileSync(path.join(OUT, 'status-audio.webm'), Buffer.from(audioBase64, 'base64'));

  await browser.close();

  for (const name of ['status-image.png', 'status-video.webm', 'status-audio.webm']) {
    const stats = fs.statSync(path.join(OUT, name));
    console.log(`${name}: ${stats.size} bytes`);
    if (stats.size < 500) throw new Error(`${name} looks empty`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
