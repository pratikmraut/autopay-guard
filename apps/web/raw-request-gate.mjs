import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isRawBffRequest,
  shouldRejectRawBffRequest,
} from "./src/lib/bff-raw-url.mjs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createRawRequestGate({
  upstreamHost = "127.0.0.1",
  upstreamPort,
}) {
  const server = http.createServer((request, response) => {
    if (shouldRejectRawBffRequest(request.url ?? "")) {
      writePolicyRejection(response);
      return;
    }
    forwardHttp(request, response, upstreamHost, upstreamPort);
  });

  server.on("upgrade", (request, socket, head) => {
    if (isRawBffRequest(request.url ?? "")) {
      writeUpgradePolicyRejection(socket);
      return;
    }
    tunnelUpgrade(request, socket, head, upstreamHost, upstreamPort);
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  return server;
}

function forwardHttp(request, response, upstreamHost, upstreamPort) {
  const upstream = http.request(
    {
      host: upstreamHost,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request),
      setHost: false,
    },
    (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      const headers = withoutHopByHopHeaders(upstreamResponse.headers);
      if (upstreamResponse.statusMessage) {
        response.writeHead(status, upstreamResponse.statusMessage, headers);
      } else {
        response.writeHead(status, headers);
      }
      upstreamResponse.once("error", () => response.destroy());
      upstreamResponse.once("aborted", () => response.destroy());
      upstreamResponse.pipe(response);
    },
  );

  upstream.once("error", () => {
    if (!response.headersSent) {
      writeGatewayFailure(response);
    } else {
      response.destroy();
    }
  });
  request.once("aborted", () => upstream.destroy());
  response.once("close", () => {
    if (!response.writableEnded) {
      upstream.destroy();
    }
  });
  request.pipe(upstream);
}

function tunnelUpgrade(
  request,
  clientSocket,
  head,
  upstreamHost,
  upstreamPort,
) {
  const upstreamSocket = net.connect(upstreamPort, upstreamHost);
  upstreamSocket.setNoDelay(true);
  upstreamSocket.once("connect", () => {
    upstreamSocket.write(
      `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`,
    );
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (
        ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"].includes(
          request.rawHeaders[index].toLowerCase(),
        )
      ) {
        continue;
      }
      upstreamSocket.write(
        `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`,
      );
    }
    upstreamSocket.write(
      `X-Forwarded-For: ${request.socket.remoteAddress ?? "unknown"}\r\n`,
    );
    upstreamSocket.write(
      `X-Forwarded-Host: ${request.headers.host ?? "unknown"}\r\n`,
    );
    upstreamSocket.write("X-Forwarded-Proto: http\r\n\r\n");
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });
  upstreamSocket.once("error", () => {
    if (clientSocket.writable) {
      clientSocket.end(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  });
  clientSocket.once("error", () => upstreamSocket.destroy());
  clientSocket.once("close", () => upstreamSocket.destroy());
}

function forwardedHeaders(request) {
  const headers = withoutHopByHopHeaders(request.headers);
  headers.host = request.headers.host ?? "localhost";
  headers["x-forwarded-for"] = request.socket.remoteAddress ?? "unknown";
  headers["x-forwarded-host"] = request.headers.host ?? "unknown";
  headers["x-forwarded-proto"] = "http";
  return headers;
}

function withoutHopByHopHeaders(headers) {
  const excluded = new Set(HOP_BY_HOP_HEADERS);
  const connection = headers.connection;
  const connectionValues = Array.isArray(connection)
    ? connection
    : [connection];
  for (const value of connectionValues) {
    for (const name of value?.split(",") ?? []) {
      if (name.trim()) {
        excluded.add(name.trim().toLowerCase());
      }
    }
  }
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        value !== undefined && !excluded.has(name.toLowerCase()),
    ),
  );
}

function writePolicyRejection(response) {
  const body = policyProblem();
  response.writeHead(404, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/problem+json",
    "x-autopay-guard-bff-path-policy": "rejected",
  });
  response.end(body);
}

function writeUpgradePolicyRejection(socket) {
  const body = policyProblem();
  socket.end(
    [
      "HTTP/1.1 404 Not Found",
      "Cache-Control: no-store",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Content-Type: application/problem+json",
      "X-AutoPay-Guard-BFF-Path-Policy: rejected",
      "Connection: close",
      "",
      body,
    ].join("\r\n"),
  );
}

function writeGatewayFailure(response) {
  const body = JSON.stringify({
    type: "about:blank",
    title: "Bad Gateway",
    status: 502,
    detail: "The local web application is not ready.",
    correlationId: randomUUID(),
  });
  response.writeHead(502, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/problem+json",
  });
  response.end(body);
}

function policyProblem() {
  return JSON.stringify({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "This BFF operation is not available.",
    correlationId: randomUUID(),
  });
}

async function run() {
  const mode = process.argv[2] ?? "start";
  if (!["dev", "start", "standalone"].includes(mode)) {
    throw new Error("Raw request gate mode must be dev, start, or standalone.");
  }
  const publicHost =
    optionValue("--hostname") ?? process.env.HOSTNAME ?? "0.0.0.0";
  const publicPort = portNumber(
    optionValue("--port") ?? process.env.PORT ?? "3000",
    "public",
  );
  const upstreamPort = portNumber(
    process.env.NEXT_INTERNAL_PORT ?? String(publicPort + 1),
    "internal",
  );
  if (publicPort === upstreamPort) {
    throw new Error("The raw request gate and Next ports must differ.");
  }

  const child = startNext(mode, upstreamPort);
  const gate = createRawRequestGate({ upstreamPort });
  let stopping = false;

  const stop = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    gate.close();
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  child.once("exit", (code, signal) => {
    gate.close();
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
  gate.once("error", (error) => {
    console.error(`Raw request gate failed: ${error.message}`);
    stop("SIGTERM");
    process.exitCode = 1;
  });
  await new Promise((resolveListen, rejectListen) => {
    gate.once("error", rejectListen);
    gate.listen(publicPort, publicHost, resolveListen);
  });
  console.log(
    `Raw request gate listening on http://${publicHost}:${publicPort} with Next on 127.0.0.1:${upstreamPort}.`,
  );
}

function startNext(mode, upstreamPort) {
  const environment = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(upstreamPort),
  };
  const applicationDirectory = dirname(fileURLToPath(import.meta.url));
  let script;
  let arguments_;
  if (mode === "standalone") {
    script = resolve(applicationDirectory, "server.js");
    arguments_ = [script];
  } else {
    const require = createRequire(import.meta.url);
    script = require.resolve("next/dist/bin/next");
    arguments_ = [
      script,
      mode,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(upstreamPort),
    ];
  }
  return spawn(process.execPath, arguments_, {
    cwd: applicationDirectory,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function portNumber(value, label) {
  if (!/^[0-9]{1,5}$/.test(value)) {
    throw new Error(`The ${label} port is invalid.`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`The ${label} port is invalid.`);
  }
  return port;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryPoint === import.meta.url) {
  await run();
}
