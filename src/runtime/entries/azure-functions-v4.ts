import "#internal/nitro/virtual/polyfill";
import {
  HttpRequest,
  HttpResponse,
  app,
  InvocationContext,
  HttpFunctionOptions,
  HttpMethod,
} from "@azure/functions";
import { v4 } from "uuid";
import {
  EventHandler,
  H3Event,
  HTTPMethod,
  createEvent,
  fromPlainHandler,
  fromWebHandler,
  toWebHandler,
  createError,
  isError,
} from "h3";
import { IncomingMessage as NodeIncomingMessage } from "unenv/runtime/node/http/_request";
import { ServerResponse as NodeServerResponse } from "unenv/runtime/node/http/_response";
import { Handle, createCall } from "unenv/runtime/fetch";
import consola from "consola";
import { nitroApp } from "../app";
import { getAzureParsedCookiesFromHeaders } from "../utils.azure";
import { normalizeLambdaOutgoingHeaders } from "../utils.lambda";
import { useRuntimeConfig } from "../config";
import { handler } from "./lagon";
import {
  HandlerDefinition,
  handlers as initialHandlers,
} from "#internal/nitro/virtual/server-handlers";
const ALLOWED_AZURE_METHODS = new Set<HttpMethod>([
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
]);
const DEFAULT_METHODS: Lowercase<HttpMethod>[] = [
  "get",
  "head",
  "patch",
  "post",
  "put",
  "delete",
  "connect",
  "options",
  "trace",
];
type Assign<T, U> = U extends Record<string, unknown> ? T & U : never;
const config = useRuntimeConfig();

function safeAssign<T, U>(target: T, source: U): Assign<T, U> {
  return { ...target, ...source } as Assign<T, U>;
}

function getHandlers() {
  console.warn("got handlers", !!config.nitro.routeRules);
  if (config.nitro.routeRules) {
    const DummyHandler: EventHandler = safeAssign(
      (event: H3Event<Request>) => new Response(),
      { __is_handler__: true }
    );
    const ruleHandlers: HandlerDefinition[] = Object.keys(
      config.nitro.routeRules
    ).map((route) => ({
      route,
      handler: () => DummyHandler,
      lazy: true,
    }));
    return [...ruleHandlers, ...initialHandlers];
  } else {
    return initialHandlers;
  }
}
/**
 * We route all functions through nitro so we dont miss a middleware
 */
const handle = toWebHandler(nitroApp.h3App);
const handlers = getHandlers();
interface GroupedResult<T> {
  [key: string]: [T, ...T[]];
}

/**
 * works like Object.groupBy and be remove in node >= v21.0
 * @param iterable
 * @param callbackFn
 * @returns
 */
function groupBy<T>(
  iterable: Iterable<T>,
  callbackFn: (item: T) => string | symbol
): GroupedResult<T> {
  const result: GroupedResult<T> = {};

  for (const item of iterable) {
    const key = callbackFn(item).toString(); // Ensure the key is a string
    if (result[key]) {
      result[key].push(item);
    } else {
      result[key] = [item];
    }
  }

  return result;
}

const handlerGroups = groupBy(
  handlers.filter((h) => !h.middleware),
  (item) => item.route
);

for (const [route, handlers] of Object.entries(handlerGroups)) {
  if (handlers.length > 1) {
    const routename = nitroToAzureRoute(route);
    const funcname = routeToFuncName(route);
    const methodsArray = handlers.map((h) => {
      return h.method;
    });

    // if there is a default endpoint trigger on every method
    const methods: Lowercase<HttpMethod>[] = methodsArray.includes(undefined)
      ? DEFAULT_METHODS
      : methodsArray;
    consola.log({ funcname, routename });
    const azureBuilder = getAzureBuilder(methods);
    azureBuilder(funcname, {
      route: routename,
      handler: async (req, ctx) => {
        const res = await handle(req as unknown as Request);
        return res as unknown as HttpResponse;
      },
    });
  } else {
    const [h, ...rest] = handlers;
    const routename = nitroToAzureRoute(route);
    const funcname = routeToFuncName(route);
    consola.log({ funcname, routename });
    const azureBuilder = getAzureBuilder(h.method);
    azureBuilder(funcname, {
      route: routename,
      handler: async (req, ctx) => {
        const res = await handle(req as unknown as Request);
        return res as unknown as HttpResponse;
      },
    });
  }
}

function routeToFuncName(route: string) {
  if (route === "/__nuxt_error") {
    return "nuxterror";
  }
  if (route === "/**") {
    return "vuePages";
  }
  // Remove leading slash and split the route by slashes
  const parts = route.replace(/^\//, "").split("/");
  // Filter and sanitize each part
  const sanitizedParts = parts
    .map((part) => {
      // Remove Numners
      part = part.replace(/\d/g, v4());
      // Remove square brackets and optional indicators
      part = part.replace(/\[\[|]]|\[|]/g, "");

      // Replace invalid characters with hyphens
      part = part.replace(/[^\dA-Za-z-]/g, "-");

      // Ensure the function name is between 1 and 60 characters
      part = part.slice(0, 60);

      return part;
    })
    .filter(Boolean);

  // Combine sanitized parts with hyphens
  return sanitizedParts.join("-").toLowerCase();
}
/**
 * maps nitro to azure route params
 * @param route
 * @returns
 */
function nitroToAzureRoute(route: string): string {
  if (route === "/**") {
    return "{*restOfPath}";
  }
  // Regular expression to match dynamic parameters and optional parameters
  const dynamicParamRegex = /\[(.*?)]/g;
  const optionalParamRegex = /\[\[([^\]]*)]]/g;
  // Replace optional parameters
  route = route.replace(optionalParamRegex, "{$1?}");

  // Replace dynamic parameters
  route = route.replace(dynamicParamRegex, "{$1}");

  // Replace the special case for matching any route
  route = route.replace(/\[\.{3}(.*?)]/g, "{*restOfPath}");

  // Remove the initial forward slash
  if (route.startsWith("/")) {
    route = route.slice(1);
  }

  return route;
}

function getAzureBuilder(
  handlerMethod: Lowercase<HttpMethod> | Lowercase<HttpMethod>[]
): (name: string, options: HttpFunctionOptions) => void {
  if (Array.isArray(handlerMethod)) {
    const m = handlerMethod
      .map((s) => s.toUpperCase() as Uppercase<HttpMethod>)
      .filter((e) => ALLOWED_AZURE_METHODS.has(e));
    return (name: string, options: Omit<HttpFunctionOptions, "methods">) =>
      app.http(name, { ...options, methods: m });
  }
  switch (handlerMethod) {
    case "get": {
      return app.get;
    }
    case "patch": {
      return app.patch;
    }
    case "post": {
      return app.post;
    }
    case "put": {
      return app.put;
    }
    case "delete": {
      return app.deleteRequest;
    }
    default: {
      return app.http;
    }
  }
}
