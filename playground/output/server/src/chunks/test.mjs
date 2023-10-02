import { e as eventHandler } from '../index.mjs';
import '@azure/functions';
import 'node:fs';
import 'node:url';
import 'crypto';

const test = eventHandler(async (event) => {
  return { ass: "master" };
});

export { test as default };
//# sourceMappingURL=test.mjs.map
