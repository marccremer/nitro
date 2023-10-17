import "#internal/nitro/virtual/polyfill";
import {
  HttpRequest,
  HttpResponse,
  app,
  InvocationContext,
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
import {
  HandlerDefinition,
  handlers,
} from "#internal/nitro/virtual/server-handlers";

const handle = toWebHandler(nitroApp.h3App);

for (const h of handlers) {
  if (h.middleware) {
    continue;
  }
  const routename = routeToRoute(h.route);
  const funcname = routeToName(h.route);
  consola.log({ funcname, routename });
  app.http(funcname, {
    route: routename,
    handler: async (req, ctx) => {
      const res = await handle(req as unknown as Request);
      return res as unknown as HttpResponse;
    },
  });
}

/* export async function handle(context: { res: HttpResponse }, req: HttpRequest) {
  const url = "/" + (req.params.url || "");

  const { body, status, statusText, headers } = await nitroApp.localCall({
    url,
    headers: req.headers,
    method: req.method,
    // https://github.com/Azure/azure-functions-host/issues/293
    body: req.rawBody,
  });
  const result = handlers
    .filter((r) => !!r.route)
    .map((h) => routeToName(h.route));
  context.res = {
    status,
    // cookies https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?tabs=typescript%2Cwindows%2Cazure-cli&pivots=nodejs-model-v4#http-response
    cookies: getAzureParsedCookiesFromHeaders(headers),
    headers: normalizeLambdaOutgoingHeaders(headers, true),
    body: result,
  };
}
 */
function routeToName(route: string | undefined) {
  const salt = v4();
  const prefix = `func-${salt}`;
  if (!route || route.length === 0) {
    return prefix;
  }
  const r = route.replace("/", "-");
  return `${prefix}-${r}`;
}

function routeToRoute(route: string) {
  if (route === "/") {
    return "root";
  }
  return route.slice(1);
}

function getAzureBuilder(handlerMethod: HandlerDefinition["method"]) {
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
