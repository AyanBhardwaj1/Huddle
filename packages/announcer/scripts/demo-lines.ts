/**
 * Spot-check the announcer end to end from the command line.
 *
 *   pnpm --filter @huddle/announcer demo-lines                 # every event, all personas
 *   pnpm --filter @huddle/announcer demo-lines -- --persona nfl
 *   pnpm --filter @huddle/announcer demo-lines -- --talk "what are the odds Portugal hits seven?"
 *
 * With no keys it prints the template lines (what the room hears through Web Speech). With
 * ANTHROPIC_API_KEY and ELEVENLABS_API_KEY set it uses the real services, prints where each line's
 * text and audio came from, and reports event-to-audio latency against the 2.5 s target. Audio lands
 * in DATA_DIR/audio-cache so you can listen to the clips.
 */
import type { Persona } from '@huddle/shared';
import { HuddleAnnouncer, LATENCY_TARGET_MS } from '../src/announcer';
import { createLlmClient } from '../src/llm';
import { PERSONA_IDS, isPersona } from '../src/personas';
import { allEvents, room, talk } from '../src/test/fixtures';
import { flag, loadEnv, option } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  const quiet = { info: () => {}, warn: (m: string) => console.warn(`  ! ${m}`) };
  const llm = createLlmClient(env, { log: quiet });
  const announcer = new HuddleAnnouncer(env, llm, { log: quiet });
  const personaArg = option('persona');
  const personas: Persona[] = personaArg && isPersona(personaArg) ? [personaArg] : PERSONA_IDS;

  const question = option('talk');
  if (question) {
    const reply = await announcer.answer(question, talk({ persona: personas[0]! }));
    console.log(reply.text);
    if (reply.draft) console.log(`draft (needs confirmation in the app): ${JSON.stringify(reply.draft)}`);
    return;
  }

  console.log(`LLM lines: ${llm.available ? 'on' : 'off (templates)'}   speech: ${announcer.provider}\n`);
  const totals: number[] = [];
  for (const persona of personas) {
    console.log(`== ${persona} ==`);
    const warmStart = Date.now();
    await announcer.warmup(persona);
    if (announcer.provider === 'elevenlabs') console.log(`  (warmup took ${Date.now() - warmStart} ms)`);
    for (const event of allEvents()) {
      const line = await announcer.announce(event, room({ persona, sport: persona === 'nfl' ? 'nfl' : 'soccer' }));
      const t = announcer.lastTiming;
      if (!line || !t) {
        console.log(`  ${event.type.padEnd(18)} (nothing to say)`);
        continue;
      }
      totals.push(t.totalMs);
      const audio = line.audioUrl ? `${t.audio} ${line.audioUrl}` : t.audio === 'off' ? 'web speech' : `web speech (${t.audio})`;
      const sfx = line.sfx ? ` sfx=${line.sfx}${line.sfxUrl ? '' : ' (client cue)'}` : '';
      console.log(`  ${event.type.padEnd(18)} ${line.text}`);
      if (flag('verbose') || announcer.provider === 'elevenlabs' || llm.available) {
        console.log(`  ${''.padEnd(18)} [text=${t.textSource} audio=${audio} ${t.totalMs} ms${sfx}]`);
      } else if (sfx) {
        console.log(`  ${''.padEnd(18)} [${sfx.trim()}]`);
      }
    }
    console.log('');
  }
  if (totals.length) {
    const sorted = [...totals].sort((a, b) => a - b);
    const over = totals.filter((t) => t > LATENCY_TARGET_MS).length;
    console.log(
      `event-to-line latency: median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted[sorted.length - 1]} ms, ` +
        `${over} of ${totals.length} over the ${LATENCY_TARGET_MS} ms target`,
    );
  }
}

void main();
