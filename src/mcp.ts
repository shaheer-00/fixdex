// Fixdex MCP server (stdio)
import { FixdexDB } from './db.js';
import { PACKAGE_VERSION } from './version.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const db = new FixdexDB();

const server = new Server(
  { name: 'fixdex', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } }
);

// MCP inputSchema must be a plain JSON Schema object, not a zod object.
// zod v4: z.toJSONSchema(zodSchema) -> JSONSchema7-like object.
const jsonSchema = (s: z.ZodType) => z.toJSONSchema(s) as Record<string, unknown>;

const ToolSchema = {
  fixdex_search: z.object({
    query: z.string(),
    project: z.string().optional(),
    tags: z.string().optional(),
  }),
  fixdex_get: z.object({ id: z.number() }),
  fixdex_save: z.object({
    problem_title: z.string(),
    symptoms: z.string(),
    root_cause: z.string().optional().nullable(),
    solution: z.string().optional().nullable(),
    summary: z.string(),
    tags: z.string().optional().nullable(),
    project: z.string().optional().nullable(),
  }),
  fixdex_feedback: z.object({ id: z.number(), helped: z.boolean() }),
  fixdex_open: z.object({}),
};

const ToolInputSchema = {
  fixdex_search: jsonSchema(ToolSchema.fixdex_search),
  fixdex_get: jsonSchema(ToolSchema.fixdex_get),
  fixdex_save: jsonSchema(ToolSchema.fixdex_save),
  fixdex_feedback: jsonSchema(ToolSchema.fixdex_feedback),
  fixdex_open: jsonSchema(ToolSchema.fixdex_open),
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'fixdex_search', description: 'Search Fixdex for known fixes. Returns top 3 summaries + confidence.', inputSchema: ToolInputSchema.fixdex_search },
    { name: 'fixdex_get',    description: 'Fetch full entry by ID.', inputSchema: ToolInputSchema.fixdex_get },
    { name: 'fixdex_save',   description: 'Save a problem+fix (deduped on signature).', inputSchema: ToolInputSchema.fixdex_save },
    { name: 'fixdex_feedback', description: 'Rate if a fix helped (ranks it up/down).', inputSchema: ToolInputSchema.fixdex_feedback },
    { name: 'fixdex_open',   description: 'List unresolved repeated problems.', inputSchema: ToolInputSchema.fixdex_open },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!Object.keys(ToolSchema).includes(name)) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    switch (name) {
      case 'fixdex_search': {
        const r = ToolSchema.fixdex_search.parse(args);
        const hits = db.search(r.query, r.project, r.tags);
        return { content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }] };
      }
      case 'fixdex_get': {
        const r = ToolSchema.fixdex_get.parse(args);
        const entry = db.get(r.id);
        if (!entry) return { content: [{ type: 'text', text: 'Not found' }] };
        db.recordUsed(r.id);
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
      }
      case 'fixdex_save': {
        const r = ToolSchema.fixdex_save.parse(args);
        const entry = db.save({
          problem_title: r.problem_title,
          symptoms: r.symptoms,
          root_cause: r.root_cause,
          solution: r.solution,
          summary: r.summary,
          tags: r.tags ?? '',
          project: r.project ?? '',
        });
        return { content: [{ type: 'text', text: `Saved entry #${entry.id} (sig=${entry.signature.slice(0,8)})` }] };
      }
      case 'fixdex_feedback': {
        const r = ToolSchema.fixdex_feedback.parse(args);
        db.feedback(r.id, r.helped);
        return { content: [{ type: 'text', text: `Feedback recorded: ${r.helped ? 'helped' : 'failed'}` }] };
      }
      case 'fixdex_open': {
        const list = db.openProblems();
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }
    }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
  return { content: [{ type: 'text', text: 'No-op' }] };
});

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => {
  console.error('Fixdex MCP fatal:', e);
  process.exit(1);
});
