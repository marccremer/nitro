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
  const routename = nitroToAzureRoute(h.route);
  const funcname = routeToFuncName(h);
  consola.log({ funcname, routename ,h });
  const azureBuilder = getAzureBuilder(h.method);
  azureBuilder(funcname, {
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
function routeToFuncName(handler:HandlerDefinition) {
  const { route,method ="any" } = handler
  if (route === "/__nuxt_error") {
    return "nuxterror";
  }
  if (route === "/**") {
    return "vuePages";
  }
  // Remove leading slash and split the route by slashes
  const parts = route.replace(/^\//, "").split("/");
  parts.push(method)
  // Filter and sanitize each part
  const sanitizedParts = parts
    .map((part) => {
      // Remove square brackets and optional indicators
      part = part.replace(/\[\[|]]|\[|]/g, "");

      // Replace invalid characters with hyphens
      part = part.replace(/[^\dA-Za-z-]/g, "-");

      // Ensure the function name is between 1 and 60 characters
      part = part.slice(0, 60);

      return part;
    })
    .filter(Boolean); // Remove empty parts
  
  // Combine sanitized parts with hyphens
  const functionName = sanitizedParts.join("-").toLowerCase()
  /*   // Apply any additional keyword exclusions here
  const excludedKeywords = ["api", "function", "route", "system"];
  for (const keyword of excludedKeywords) {
    if (functionName.toLowerCase().includes(keyword)) {
      return "invalid"; // You can choose how to handle excluded keywords
    }
  } */

  return functionName;
}

function nitroToAzureRoute(routeA: string): string {
  if (routeA === "/**") {
    return "{*restOfPath}";
  }
  // Regular expression to match dynamic parameters and optional parameters
  const dynamicParamRegex = /\[(.*?)]/g;
  const optionalParamRegex = /\[\[([^\]]*)]]/g;
  // Replace optional parameters in System B
  routeA = routeA.replace(optionalParamRegex, "{$1?}");

  // Replace dynamic parameters with curly braces in System B
  routeA = routeA.replace(dynamicParamRegex, "{$1}");

  // Replace the special case for matching any route
  routeA = routeA.replace(/\[\.{3}(.*?)]/g, "{*restOfPath}");

  // Remove the initial forward slash
  if (routeA.startsWith("/")) {
    routeA = routeA.slice(1);
  }

  return routeA;
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
