import { test, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { FixdexDB } from '../src/db.js';
import { createMcpServer } from '../src/mcp.js';

const db = new FixdexDB(join(tmpdir(), `fixdex-mcp-test-${process.pid}.db`));

after(() => process.exit(0));

async function makeClient(): Promise<{ client: Client; server: Server }> {
  const server = createMcpServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'fixdex-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, server };
}

async function tearDown(c: Client, s: Server) {
  try { await c.close(); } catch { /* ignore */ }
  try { await s.close(); } catch { /* ignore */ }
}

test('tools/list returns all 5 tools with hints', async () => {
  const { client, server } = await makeClient();
  try {
    const list = await client.listTools() as unknown as {
      tools: Array<{
        name: string; annotations?: unknown;
      }>;
    };
    const tools = list.tools;
    assert.equal(tools.length, 5);

    const names = tools.map((t) => t.name);
    for (const n of ['fixdex_search', 'fixdex_get', 'fixdex_save', 'fixdex_feedback', 'fixdex_open']) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }

    const byName = Object.fromEntries(tools.map((t) => [t.name, (t as any).annotations ?? {}]));
    const h = (a: any) => [a.readOnlyHint, a.destructiveHint, a.idempotentHint, a.openWorldHint];
    assert.deepEqual(h(byName.fixdex_search), [true, false, true, true]);
    assert.deepEqual(h(byName.fixdex_get), [true, false, true, true]);
    assert.deepEqual(h(byName.fixdex_save), [false, false, false, true]);
    assert.deepEqual(h(byName.fixdex_feedback), [false, false, false, true]);
    assert.deepEqual(h(byName.fixdex_open), [true, false, true, true]);
  } finally {
    await tearDown(client, server);
  }
});

test('fixdex_save creates entry', async () => {
  const { client, server } = await makeClient();
  try {
    const r: any = await client.callTool({
      name: 'fixdex_save',
      arguments: {
        problem_title: 'Test MCP save',
        symptoms: 'Error: boom at /test/file.ts:1:1',
        root_cause: 'bad code',
        solution: 'fix code',
        summary: 'MCP save fix',
        tags: 'mcp',
        project: 'mcp-test',
      },
    });
    assert.ok(r.content[0]?.text?.startsWith('Saved entry'), `got: ${r.content[0]?.text}`);
  } finally {
    await tearDown(client, server);
  }
});

test('fixdex_search returns matches', async () => {
  const { client, server } = await makeClient();
  try {
    const r: any = await client.callTool({
      name: 'fixdex_search',
      arguments: { query: 'boom at /test/file.ts' },
    });
    const hits = JSON.parse(r.content[0]?.text ?? '[]');
    assert.ok(Array.isArray(hits));
    assert.ok(hits.length >= 1);
  } finally {
    await tearDown(client, server);
  }
});

test('fixdex_get returns saved entry', async () => {
  const { client, server } = await makeClient();
  try {
    const saveRes: any = await client.callTool({
      name: 'fixdex_save',
      arguments: {
        problem_title: 'Get test',
        symptoms: 'Error: unique-get-error 999',
        summary: 'get fix',
        tags: '', project: '',
      },
    });
    const match = saveRes.content[0]?.text?.match(/#(\d+)/);
    assert.ok(match, 'could not parse entry id from save response');
    const id = Number(match[1]);

    const r: any = await client.callTool({ name: 'fixdex_get', arguments: { id } });
    const entry = JSON.parse(r.content[0]?.text);
    assert.equal(entry.id, id);
    assert.equal(entry.problem_title, 'Get test');
  } finally {
    await tearDown(client, server);
  }
});

test('fixdex_feedback records feedback', async () => {
  const { client, server } = await makeClient();
  try {
    const saveRes: any = await client.callTool({
      name: 'fixdex_save',
      arguments: {
        problem_title: 'Feedback test',
        symptoms: 'Error: unique-fb-error 888',
        summary: 'fb fix',
        tags: '', project: '',
      },
    });
    const match = saveRes.content[0]?.text?.match(/#(\d+)/);
    assert.ok(match);
    const id = Number(match[1]);

    const r: any = await client.callTool({ name: 'fixdex_feedback', arguments: { id, helped: true } });
    assert.ok(r.content[0]?.text?.includes('helped'));
  } finally {
    await tearDown(client, server);
  }
});

test('fixdex_open lists entries', async () => {
  const { client, server } = await makeClient();
  try {
    await client.callTool({
      name: 'fixdex_save',
      arguments: {
        problem_title: 'Open test',
        symptoms: 'Error: unique-open-error 777',
        summary: 'open fix',
        tags: '', project: '',
      },
    });
    const r: any = await client.callTool({ name: 'fixdex_open', arguments: {} });
    const list = JSON.parse(r.content[0]?.text ?? '[]');
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
  } finally {
    await tearDown(client, server);
  }
});
