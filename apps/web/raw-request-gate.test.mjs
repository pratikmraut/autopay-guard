import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";

import { createRawRequestGate } from "./raw-request-gate.mjs";
import {
  isCanonicalRawBffRequest,
  isRawBffRequest,
  shouldRejectRawBffRequest,
} from "./src/lib/bff-raw-url.mjs";

const rejectedTargets = [
  "/api/bff/v1/privacy/%2e%2e/me",
  String.raw`/api/bff\v1\me`,
  "/api/bff%5Cv1%5Cme",
  "/api/bff%2Fv1%2Fme",
  "/api%2Fbff/v1/me",
  "/api/%62ff/v1/me",
  "/api/foo/../bff/v1/me",
  "/foo/%2e%2e/api/bff/v1/me",
  "/api/bffx/%2e%2e/bff/v1/me",
  "/api//bff/v1/me",
  "//api/bff/v1/me",
  "/api/bff/v1/me/.",
  "http://localhost:3000/foo/../api/bff/v1/me",
];

let upstream;
let gate;
let gatePort;
let upstreamRequests = 0;
let upstreamUpgrades = 0;

before(async () => {
  upstream = http.createServer((_request, response) => {
    upstreamRequests += 1;
    response.writeHead(204);
    response.end();
  });
  upstream.on("upgrade", (_request, socket) => {
    upstreamUpgrades += 1;
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
  });
  const upstreamPort = await listen(upstream);
  gate = createRawRequestGate({ upstreamPort });
  gatePort = await listen(gate);
});

after(async () => {
  await close(gate);
  await close(upstream);
});

test("shared policy accepts only literal canonical BFF targets", () => {
  assert.equal(isRawBffRequest("/api/bff/v1/me"), true);
  assert.equal(isCanonicalRawBffRequest("/api/bff/v1/me?limit=1"), true);
  assert.equal(shouldRejectRawBffRequest("/api/bff/v1/me"), false);
  for (const target of rejectedTargets) {
    assert.equal(isRawBffRequest(target), true, target);
    assert.equal(isCanonicalRawBffRequest(target), false, target);
    assert.equal(shouldRejectRawBffRequest(target), true, target);
  }
});

test("pre-Next gate rejects aliases without upstream use", async () => {
  const beforeCount = upstreamRequests;
  for (const target of rejectedTargets) {
    const response = await rawRequest(gatePort, target);
    assert.equal(response.status, 404, target);
    assert.equal(
      response.headers["x-autopay-guard-bff-path-policy"],
      "rejected",
      target,
    );
    assert.equal(response.headers.location, undefined, target);
    assert.equal(response.headers["cache-control"], "no-store", target);
    assert.equal(JSON.parse(response.body).status, 404, target);
  }
  assert.equal(upstreamRequests, beforeCount);
});

test("pre-Next gate streams canonical and non-BFF requests upstream", async () => {
  const beforeCount = upstreamRequests;
  for (const target of ["/api/bff/v1/me?limit=1", "/signin"]) {
    const response = await rawRequest(gatePort, target);
    assert.equal(response.status, 204, target);
  }
  assert.equal(upstreamRequests, beforeCount + 2);
});

test("pre-Next gate rejects every BFF upgrade and tunnels only non-BFF upgrades", async () => {
  const beforeCount = upstreamUpgrades;
  for (const target of ["/api//bff/v1/me", "/api/bff/v1/me"]) {
    const rejected = await rawUpgrade(gatePort, target);
    assert.match(rejected, /^HTTP\/1\.1 404 Not Found\r\n/, target);
    assert.match(
      rejected,
      /\r\nX-AutoPay-Guard-BFF-Path-Policy: rejected\r\n/i,
      target,
    );
    assert.doesNotMatch(rejected, /\r\nLocation:/i, target);
  }
  assert.equal(upstreamUpgrades, beforeCount);

  const allowed = await rawUpgrade(gatePort, "/_next/webpack-hmr");
  assert.match(allowed, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
  assert.equal(upstreamUpgrades, beforeCount + 1);
});

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Test server did not expose a TCP port."));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

function rawRequest(port, path) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolveRequest({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode,
          }),
        );
      },
    );
    request.once("error", rejectRequest);
    request.end();
  });
}

function rawUpgrade(port, path) {
  return new Promise((resolveUpgrade, rejectUpgrade) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks = [];
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("end", () => resolveUpgrade(chunks.join("")));
    socket.once("error", rejectUpgrade);
  });
}
