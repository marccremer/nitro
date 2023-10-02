import { e as eventHandler } from '../index.mjs';
import '@azure/functions';
import 'node:fs';
import 'node:url';
import 'crypto';

const index = eventHandler(async (event) => {
  return { ass: "master" };
});

export { index as default };
//# sourceMappingURL=index.mjs.map
