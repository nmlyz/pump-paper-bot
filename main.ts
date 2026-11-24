// Pump Paper Bot: traction momentum + completion chase on the pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy lives
// in strategy.ts and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored
// byte for byte (apart from the file name in its header comment).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
