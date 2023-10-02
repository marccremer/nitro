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
import { nitroApp } from "../app";
import { getAzureParsedCookiesFromHeaders } from "../utils.azure";
import { normalizeLambdaOutgoingHeaders } from "../utils.lambda";
import {
  HandlerDefinition,
  handlers,
} from "#internal/nitro/virtual/server-handlers";

for (const handle of handlers.filter((h) => !!h.route)) {
  const createAzureFunction = getAzureBuilder(handle.method);
  const name = routeToName(handle.route);
  const fun = handle.handler as EventHandler;
  createAzureFunction(name, {
    route: handle.route,
    handler: async (req, ctx) => {
      const { body, status, headers } = await _handleAzureRequest(
        req,
        ctx,
        fun
      );
      return {
        status,
        body,
        headers: normalizeLambdaOutgoingHeaders(headers, true),
      };
    },
  });
}

async function _handleAzureRequest(
  req: HttpRequest,
  ctx: InvocationContext,
  handler: EventHandler
) {
  const path = req.url;
  const method = (req.method || "GET").toUpperCase() as HTTPMethod;
  const headers = req.headers as Headers;

  // Shim for Node.js request and response objects
  // TODO: Remove in next major version
  const nodeReq =
    new NodeIncomingMessage() as unknown /* unenv */ as IncomingMessage;
  const nodeRes = new NodeServerResponse(nodeReq);

  // Fill node request properties
  nodeReq.method = method;
  nodeReq.url = path;
  // TODO: Normalize with array merge and lazy getter
  nodeReq.headers = Object.fromEntries(headers.entries());

  // Create new event
  const event = createEvent(nodeReq, nodeRes);

  // Fill internal event properties
  event._method = method;
  event._path = path;
  event._headers = headers;
  if (req.body) {
    event._requestBody = req.body;
  }

  Object.assign(event.context, { azure: ctx });

  // Run app handler logic
  try {
    await handler(event);
  } catch (_error: any) {
    const error = createError(_error);
    if (!isError(_error)) {
      error.unhandled = true;
    }

    return {
      status: 500,
      body: error,
    };
  }

  return {
    status: nodeRes.statusCode,
    statusText: nodeRes.statusMessage,
    headers: nodeRes._headers,
    body: (nodeRes as any)._data,
  };
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
