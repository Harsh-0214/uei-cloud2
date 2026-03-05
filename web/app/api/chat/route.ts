import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_query',
    description:
      'Execute a SQL SELECT query against the PostgreSQL database. ' +
      'Always use this to fetch real data before answering. Returns up to 200 rows as JSON.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'A valid SQL SELECT statement.' },
      },
      required: ['sql'],
    },
  },
];

async function getSchema(): Promise<string> {
  try {
    const res = await fetch(`${process.env.API_URL}/schema`, {
      next: { revalidate: 300 },
    });
    return res.ok ? await res.text() : '(Schema unavailable)';
  } catch {
    return '(Schema unavailable)';
  }
}

async function executeQuery(sql: string): Promise<unknown[]> {
  const res = await fetch(`${process.env.API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Query failed' }));
    throw new Error(err.detail ?? 'Query failed');
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  const { message, history = [] } = await req.json();

  const schema = await getSchema();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system = `You are a helpful data analyst assistant for the UEI (Unified Energy Interface) platform.
You answer questions about battery management system telemetry data stored in a PostgreSQL database.

${schema}

Instructions:
- Always call run_query to retrieve actual data before answering.
- Provide clear, insightful summaries with observations and trends.
- Format values with appropriate units (V, A, %, °C) where applicable.
- Keep responses concise but informative.
- If a query returns no results, say so clearly.
- Never invent data.`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const messages: Anthropic.MessageParam[] = [
        ...history,
        { role: 'user', content: message },
      ];

      try {
        while (true) {
          const apiStream = client.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system,
            tools: TOOLS,
            messages,
          });

          for await (const event of apiStream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              send({ type: 'text', text: event.delta.text });
            } else if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              send({ type: 'thinking' });
            }
          }

          const final = await apiStream.finalMessage();

          if (final.stop_reason === 'end_turn') {
            const text = final.content
              .filter((b) => b.type === 'text')
              .map((b) => (b as Anthropic.TextBlock).text)
              .join('');
            send({ type: 'done', assistantText: text });
            break;
          }

          if (final.stop_reason === 'tool_use') {
            messages.push({ role: 'assistant', content: final.content });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of final.content) {
              if (block.type !== 'tool_use') continue;
              const sql = (block.input as { sql: string }).sql;
              try {
                const rows = await executeQuery(sql);
                send({ type: 'query', sql, rows: rows.length });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(rows),
                });
              } catch (e) {
                send({ type: 'query_error', error: String(e) });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Error: ${e}`,
                  is_error: true,
                });
              }
            }
            messages.push({ role: 'user', content: toolResults });
          } else {
            send({ type: 'done', assistantText: '' });
            break;
          }
        }
      } catch (e) {
        send({ type: 'error', text: String(e) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
