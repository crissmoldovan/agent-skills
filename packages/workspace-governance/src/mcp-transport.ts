import { PassThrough, type Readable, type Writable } from "node:stream";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

type JSONRPCMessage = ReturnType<typeof JSONRPCMessageSchema.parse>;

export const MAX_MCP_FRAME_BYTES = 1024 * 1024;
export const MAX_MCP_REQUEST_ID_BYTES = 256;
export const MAX_MCP_OUTSTANDING_REQUESTS = 32;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;
const TOO_MANY_REQUESTS = -32000;

type RequestId = string | number;

function serializedBytes(message: unknown): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8") + 1;
}

function safeId(value: unknown): RequestId | null {
  if (typeof value === "string")
    return Buffer.byteLength(value, "utf8") <= MAX_MCP_REQUEST_ID_BYTES ? value : null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requestKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

function errorResponse(id: RequestId | null, code: number, message: string): JSONRPCMessage {
  return { jsonrpc: "2.0", id, error: { code, message } } as JSONRPCMessage;
}

/**
 * Keeps the official SDK stdio transport while enforcing product-level frame,
 * response, request-id, and in-flight request bounds around it.
 */
export class BoundedStdioServerTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly framedInput = new PassThrough();
  private readonly input: Readable;
  private readonly transport: StdioServerTransport;
  private readonly pending = new Set<string>();
  private parts: Buffer[] = [];
  private lineBytes = 0;
  private discarding = false;
  private started = false;
  private closed = false;

  constructor(
    input: Readable = process.stdin,
    output: Writable = process.stdout,
  ) {
    this.input = input;
    this.transport = new StdioServerTransport(this.framedInput, output, {
      maxBufferSize: MAX_MCP_FRAME_BYTES,
    });
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      const end = newline < 0 ? bytes.length : newline;
      const segment = bytes.subarray(offset, end);
      if (!this.discarding) {
        if (this.lineBytes + segment.length + (newline < 0 ? 0 : 1) > MAX_MCP_FRAME_BYTES) {
          this.discarding = true;
          this.parts = [];
          this.lineBytes = 0;
        } else if (segment.length > 0) {
          this.parts.push(Buffer.from(segment));
          this.lineBytes += segment.length;
        }
      }
      if (newline < 0) return;
      if (this.discarding) {
        void this.writeError(null, INVALID_REQUEST, "Request frame exceeds maximum size.");
      } else {
        const line = Buffer.concat(this.parts, this.lineBytes);
        try {
          const decoded = JSON.parse(line.toString("utf8"));
          if (!JSONRPCMessageSchema.safeParse(decoded).success) {
            void this.writeError(null, INVALID_REQUEST, "Invalid JSON-RPC request.");
          } else {
            this.framedInput.write(Buffer.concat([line, Buffer.from("\n")]));
          }
        } catch {
          void this.writeError(null, PARSE_ERROR, "Parse error.");
        }
      }
      this.parts = [];
      this.lineBytes = 0;
      this.discarding = false;
      offset = newline + 1;
    }
  };

  private readonly handleEnd = (): void => {
    if (this.discarding)
      void this.writeError(null, INVALID_REQUEST, "Request frame exceeds maximum size.");
    this.parts = [];
    this.lineBytes = 0;
    this.discarding = false;
    this.framedInput.end();
  };

  private readonly handleInputError = (error: Error): void => {
    this.onerror?.(error);
    this.framedInput.destroy(error);
  };

  async start(): Promise<void> {
    if (this.started) throw new Error("BoundedStdioServerTransport already started");
    this.started = true;
    this.transport.onclose = () => { this.onclose?.(); };
    this.transport.onerror = error => { this.onerror?.(error); };
    this.transport.onmessage = message => { this.receive(message); };
    await this.transport.start();
    this.input.on("data", this.handleData);
    this.input.on("end", this.handleEnd);
    this.input.on("close", this.handleEnd);
    this.input.on("error", this.handleInputError);
    if ((this.input as Readable & { readableEnded?: boolean }).readableEnded)
      this.handleEnd();
  }

  private receive(message: JSONRPCMessage): void {
    const candidate = message as unknown as Record<string, unknown>;
    if (candidate.method === "notifications/cancelled") {
      const params = candidate.params;
      const cancelledId = params !== null && typeof params === "object"
        ? safeId((params as Record<string, unknown>).requestId)
        : null;
      // The SDK may suppress the terminal response for a cancelled request,
      // so protocol bookkeeping retires here. The independent service gate
      // retains the actual operation slot until its handler settles.
      if (cancelledId !== null) this.pending.delete(requestKey(cancelledId));
    }
    if (typeof candidate.method === "string" && Object.hasOwn(candidate, "id")) {
      const id = safeId(candidate.id);
      if (id === null) {
        void this.writeError(null, INVALID_REQUEST, "Invalid or oversized request id.");
        return;
      }
      const key = requestKey(id);
      if (this.pending.has(key)) {
        void this.writeError(id, INVALID_REQUEST, "Duplicate request id.");
        return;
      }
      if (this.pending.size >= MAX_MCP_OUTSTANDING_REQUESTS) {
        void this.writeError(id, TOO_MANY_REQUESTS, "Too many outstanding requests.");
        return;
      }
      this.pending.add(key);
    }
    this.onmessage?.(message);
  }

  private settle(message: JSONRPCMessage): void {
    const candidate = message as unknown as Record<string, unknown>;
    if (!Object.hasOwn(candidate, "id") || (!Object.hasOwn(candidate, "result") && !Object.hasOwn(candidate, "error"))) return;
    const id = safeId(candidate.id);
    if (id !== null) this.pending.delete(requestKey(id));
  }

  private writeError(id: RequestId | null, code: number, message: string): Promise<void> {
    return this.transport.send(errorResponse(id, code, message));
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.settle(message);
    if (serializedBytes(message) <= MAX_MCP_FRAME_BYTES) {
      await this.transport.send(message);
      return;
    }
    const candidate = message as unknown as Record<string, unknown>;
    if (Object.hasOwn(candidate, "id")) {
      await this.writeError(safeId(candidate.id), INTERNAL_ERROR, "Protocol response exceeds maximum size.");
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.off("data", this.handleData);
    this.input.off("end", this.handleEnd);
    this.input.off("close", this.handleEnd);
    this.input.off("error", this.handleInputError);
    if (this.input.listenerCount("data") === 0) this.input.pause();
    this.parts = [];
    this.pending.clear();
    this.framedInput.end();
    await this.transport.close();
  }
}
