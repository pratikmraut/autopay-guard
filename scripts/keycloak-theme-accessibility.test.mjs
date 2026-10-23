import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(
  new URL(
    "../infra/local/keycloak-theme/autopay-guard/login/resources/js/tab-order.js",
    import.meta.url,
  ),
  "utf8",
);

function fixture(readyState, tabIndexes) {
  const removals = [];
  const listeners = [];
  let queries = 0;
  const elements = tabIndexes.map((tabIndex, index) => ({
    tabIndex,
    get value() {
      assert.fail("Tab-order cleanup must not read any form value.");
    },
    removeAttribute(name) {
      assert.equal(name, "tabindex");
      removals.push(index);
    },
  }));
  const document = {
    readyState,
    querySelectorAll(selector) {
      assert.equal(selector, "[tabindex]");
      queries += 1;
      return elements;
    },
    addEventListener(name, callback, options) {
      assert.equal(name, "DOMContentLoaded");
      assert.equal(options.once, true);
      assert.deepEqual(Object.keys(options), ["once"]);
      listeners.push(callback);
    },
  };
  return {
    run: () => runInNewContext(script, { document }, { timeout: 1_000 }),
    removals,
    listeners,
    get queries() {
      return queries;
    },
  };
}

test("ready document removes positive tabindex only, preserving zero and negative values", () => {
  const mock = fixture("complete", [2, -1, 0, 1, 8, -2, 32767]);
  mock.run();
  assert.deepEqual(mock.removals, [0, 3, 4, 6]);
  assert.equal(mock.queries, 1);
  assert.equal(mock.listeners.length, 0);
});

test("loading document waits for one DOMContentLoaded callback before inspecting controls", () => {
  const mock = fixture("loading", [2, 0, -1, 3]);
  mock.run();
  assert.equal(mock.queries, 0);
  assert.deepEqual(mock.removals, []);
  assert.equal(mock.listeners.length, 1);
  mock.listeners[0]();
  assert.equal(mock.queries, 1);
  assert.deepEqual(mock.removals, [0, 3]);
});

test("interactive document restores tab order immediately", () => {
  const mock = fixture("interactive", [5]);
  mock.run();
  assert.deepEqual(mock.removals, [0]);
  assert.equal(mock.queries, 1);
  assert.equal(mock.listeners.length, 0);
});

test("page without tabindex attributes is left unchanged", () => {
  const mock = fixture("complete", []);
  mock.run();
  assert.deepEqual(mock.removals, []);
  assert.equal(mock.queries, 1);
});
