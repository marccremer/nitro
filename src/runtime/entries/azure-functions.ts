import "#internal/nitro/virtual/polyfill";
import { HttpRequest, HttpResponse, app } from "@azure/functions";
import { nitroApp } from "../app";
import { getAzureParsedCookiesFromHeaders } from "../utils.azure";
import { normalizeLambdaOutgoingHeaders } from "../utils.lambda";
import {
  HandlerDefinition,
  handlers,
} from "#internal/nitro/virtual/server-handlers";

export async function handle(context: { res: HttpResponse }, req: HttpRequest) {
  const url = "/" + (req.params.url || "");

  const { body, status, statusText, headers } = await nitroApp.localCall({
    url,
    headers: req.headers,
    method: req.method,
    // https://github.com/Azure/azure-functions-host/issues/293
    body: req.rawBody,
  });

  context.res = {
    status,
    // cookies https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?tabs=typescript%2Cwindows%2Cazure-cli&pivots=nodejs-model-v4#http-response
    cookies: getAzureParsedCookiesFromHeaders(headers),
    headers: normalizeLambdaOutgoingHeaders(headers, true),
    body: body ? body.toString() : statusText,
  };
}

const supportedMethods = ["delete", "get", "patch", "post", "put"];
for (const handle of handlers) {
  const createAzureFunction = getAzureBuilder(handle.method);
  const name = handle.route.replace("/", "-");
/*   createAzureFunction(handle.route, {
    route: handle.route,
    handler: async (ctx, req) => {
      return { body: "" };
    },
  }); */
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
