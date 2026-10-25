// Serves the narration test's recorder on localhost, where the microphone is allowed (D131).
// node scripts/voice-test/serve.mjs, then open http://localhost:3120
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const page = new URL('./recorder.html', import.meta.url);
const port = Number(process.env.PORT) || 3120;

createServer(async (req, res) => {
  if (req.url !== '/' && req.url !== '/recorder.html') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(page));
}).listen(port, '127.0.0.1', () => console.log(`Recorder on http://localhost:${port}`));
