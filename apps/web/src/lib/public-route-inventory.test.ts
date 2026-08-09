import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(process.cwd(), "src", "app");

describe("public route inventory", () => {
  it("keeps every page and route outside the authenticated group explicit", () => {
    expect(discoverPublicRouteFiles(appRoot)).toEqual([
      "api/auth/[...nextauth]/route.ts",
      "api/bff/[...path]/route.ts",
      "page.tsx",
      "privacy/page.tsx",
      "signin/page.tsx",
    ]);
  });

  it("keeps the authenticated route-group layout fail-closed", () => {
    const layout = readFileSync(
      join(appRoot, "(authenticated)", "layout.tsx"),
      "utf8",
    );

    expect(layout).toMatch(/await\s+requireSessionUser\s*\(/);
  });

  it("keeps route handlers out of the authenticated page group", () => {
    expect(discoverRouteHandlerFiles(join(appRoot, "(authenticated)"))).toEqual(
      [],
    );
  });
});

function discoverPublicRouteFiles(directory: string): string[] {
  const routes: string[] = [];
  visit(directory, routes);
  return routes.sort();
}

function discoverRouteHandlerFiles(directory: string): string[] {
  const handlers: string[] = [];
  visitRouteHandlers(directory, handlers);
  return handlers.sort();
}

function visitRouteHandlers(directory: string, handlers: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visitRouteHandlers(path, handlers);
    } else if (/^route\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
      handlers.push(relative(appRoot, path).split(sep).join("/"));
    }
  }
}

function visit(directory: string, routes: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "(authenticated)") {
        visit(path, routes);
      }
      continue;
    }
    if (/^(?:page|route)\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
      routes.push(relative(appRoot, path).split(sep).join("/"));
    }
  }
}
