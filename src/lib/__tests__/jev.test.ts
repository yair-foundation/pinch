import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { askJevQuestions, JEV_MODEL, THRESHOLD } from '../jev';

const questions = {
  type: { type: 'noul', instructions: 'Is this about typography?' },
  colour: { type: 'noul', instructions: 'Is this about colour?' },
};

describe('askJevQuestions', () => {
  it('needs a key', async () => {
    delete process.env.JEV_API_KEY;
    const reply = await askJevQuestions({ text: 'x' }, questions);
    assert.deepEqual(reply, { ok: false, error: 'JEV_API_KEY is not set.' });
  });

  it('holds the threshold at 0.6', () => {
    assert.equal(THRESHOLD, 0.6);
    assert.equal(JEV_MODEL, 'jev-1.13.0');
  });

  describe('against a local endpoint', () => {
    let seen: { auth: string | undefined; body: unknown } | undefined;
    let status = 200;
    let answer: unknown = {
      model: 'jev-test',
      answers: { type: { type: 'noul', noul: 0.9 }, colour: { type: 'noul', noul: 0.1 } },
      usage: { input_tokens: 12 },
    };
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        seen = { auth: req.headers.authorization, body: JSON.parse(body) };
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(answer));
      });
    });

    before(async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      process.env.JEV_API_KEY = 'stub';
      process.env.JEV_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => {
      server.close();
      delete process.env.JEV_API_KEY;
      delete process.env.JEV_ENDPOINT;
    });

    it('sends the model, state and questions with the key, and reads the answers', async () => {
      const reply = await askJevQuestions({ text: 'The font is too small' }, questions);
      assert.equal(seen?.auth, 'Bearer stub');
      assert.deepEqual(seen?.body, {
        model: JEV_MODEL,
        state: { text: 'The font is too small' },
        questions,
      });
      assert.ok(reply.ok);
      if (!reply.ok) return;
      assert.equal(reply.model, 'jev-test');
      assert.equal(reply.inputTokens, 12);
      assert.equal(reply.answers.type.noul, 0.9);
    });

    it('reports a bad status, naming the key on 401', async () => {
      status = 401;
      assert.deepEqual(await askJevQuestions({}, questions), {
        ok: false,
        error: 'Jev returned 401 (check JEV_API_KEY).',
      });
      status = 500;
      assert.deepEqual(await askJevQuestions({}, questions), {
        ok: false,
        error: 'Jev returned 500.',
      });
      status = 200;
    });

    it('reports a reply with no answers', async () => {
      answer = { model: 'jev-test' };
      assert.deepEqual(await askJevQuestions({}, questions), {
        ok: false,
        error: 'Jev sent no answers.',
      });
    });
  });

  it('never throws when the endpoint is unreachable', async () => {
    process.env.JEV_API_KEY = 'stub';
    process.env.JEV_ENDPOINT = 'http://127.0.0.1:9';
    try {
      const reply = await askJevQuestions({}, questions);
      assert.equal(reply.ok, false);
    } finally {
      delete process.env.JEV_API_KEY;
      delete process.env.JEV_ENDPOINT;
    }
  });
});
