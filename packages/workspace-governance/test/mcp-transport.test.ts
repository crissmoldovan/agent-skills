import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  BoundedStdioServerTransport,
  MAX_MCP_FRAME_BYTES,
  MAX_MCP_OUTSTANDING_REQUESTS,
  MAX_MCP_REQUEST_ID_BYTES,
} from "../src/mcp-transport.ts";

function nextLine(stream: PassThrough): Promise<{ message: any; bytes: number }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      stream.off("data", onData);
      try {
        const line = buffer.subarray(0, newline);
        resolve({ message: JSON.parse(line.toString("utf8")), bytes: line.length + 1 });
      } catch (error) {
        reject(error);
      }
    };
    stream.on("data", onData);
  });
}

function request(id: string | number, method = "tools/list"): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }) + "\n";
}

test("bounded official stdio transport refuses malformed and oversized frames then accepts a valid follow-up", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new BoundedStdioServerTransport(input, output);
  const delivered: any[] = [];
  transport.onmessage = message => { delivered.push(message); };
  await transport.start();
  try {
    let replyPromise = nextLine(output);
    input.write('{"jsonrpc":"2.0",\n');
    let reply = await replyPromise;
    assert.equal(reply.message.error.code, -32700);
    assert.equal(reply.message.id, null);
    assert.ok(reply.bytes <= MAX_MCP_FRAME_BYTES);

    replyPromise = nextLine(output);
    input.write(Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"value":"'),
      Buffer.alloc(MAX_MCP_FRAME_BYTES, 0x78),
      Buffer.from('"}}\n'),
    ]));
    reply = await replyPromise;
    assert.equal(reply.message.error.code, -32600);
    assert.equal(reply.message.id, null);
    assert.ok(reply.bytes <= MAX_MCP_FRAME_BYTES);

    input.write(request(3));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered.at(-1)?.id, 3);
  } finally {
    await transport.close();
  }
});

test("bounded official stdio transport caps ids, outgoing messages, and outstanding requests", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new BoundedStdioServerTransport(input, output);
  const delivered: any[] = [];
  transport.onmessage = message => { delivered.push(message); };
  await transport.start();
  try {
    let replyPromise = nextLine(output);
    input.write(request("x".repeat(MAX_MCP_REQUEST_ID_BYTES + 1)));
    let reply = await replyPromise;
    assert.equal(reply.message.error.code, -32600);
    assert.equal(reply.message.id, null);
    assert.equal(delivered.length, 0);

    const batch = Array.from({ length: MAX_MCP_OUTSTANDING_REQUESTS + 1 }, (_, index) => request(index + 1)).join("");
    replyPromise = nextLine(output);
    input.write(batch);
    reply = await replyPromise;
    assert.equal(reply.message.error.code, -32000);
    assert.equal(reply.message.id, MAX_MCP_OUTSTANDING_REQUESTS + 1);
    assert.equal(delivered.length, MAX_MCP_OUTSTANDING_REQUESTS);

    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2, reason: "synthetic" } }) + "\n");
    input.write(request("after-cancel"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered.at(-1)?.id, "after-cancel");

    replyPromise = nextLine(output);
    await transport.send({
      jsonrpc: "2.0",
      id: 1,
      result: { value: "x".repeat(MAX_MCP_FRAME_BYTES) },
    } as any);
    reply = await replyPromise;
    assert.equal(reply.message.error.code, -32603);
    assert.equal(reply.message.id, 1);
    assert.ok(reply.bytes <= MAX_MCP_FRAME_BYTES);

    for (let id = 3; id <= MAX_MCP_OUTSTANDING_REQUESTS; id++) {
      await transport.send({ jsonrpc: "2.0", id, result: {} } as any);
      await nextLine(output);
    }
    await transport.send({ jsonrpc: "2.0", id: "after-cancel", result: {} } as any);
    await nextLine(output);
    input.write(request("follow-up"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered.at(-1)?.id, "follow-up");
  } finally {
    await transport.close();
  }
});
