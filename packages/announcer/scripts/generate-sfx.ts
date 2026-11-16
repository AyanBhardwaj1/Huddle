/**
 * Generate the five announcer stingers with ElevenLabs Sound Effects and cache them in
 * `packages/announcer/assets/sfx/<name>.mp3` (PRD section 7, "Sound effects").
 *
 *   pnpm --filter @huddle/announcer sfx            # generate the missing ones
 *   pnpm --filter @huddle/announcer sfx -- --force # regenerate all
 *
 * Verified against the official API reference on 2026-11-16:
 *   POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128
 *   header xi-api-key, body { text, duration_seconds (0.5..30), prompt_influence (0..1), model_id? }
 *   200 -> audio bytes. `model_id` is only sent when ELEVENLABS_SFX_MODEL is set (API default otherwise).
 *
 * With no ELEVENLABS_API_KEY this prints what it would do and exits 0: the announcer then sends
 * `sfx` without `sfxUrl` and clients synthesize a cue.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { redact } from '../src/log';
import { SFX_NAMES, SFX_PROMPTS, sfxDir, sfxFile } from '../src/sfx';
import { ELEVENLABS_BASE_URL, describeError } from '../src/tts';
import { flag, loadEnv } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const force = flag('force');
  const dir = sfxDir(env);
  const base = (env.ELEVENLABS_BASE_URL?.trim() || ELEVENLABS_BASE_URL).replace(/\/+$/, '');
  const model = env.ELEVENLABS_SFX_MODEL?.trim();

  if (!apiKey) {
    console.log('ELEVENLABS_API_KEY is not set: nothing generated.');
    console.log(`Stingers would be written to ${dir}:`);
    for (const name of SFX_NAMES) console.log(`  ${name}.mp3  <-  "${SFX_PROMPTS[name].text}" (${SFX_PROMPTS[name].durationSeconds} s)`);
    console.log('Without these files the announcer still sets line.sfx, and clients synthesize a cue.');
    return;
  }

  mkdirSync(dir, { recursive: true });
  let failed = 0;
  for (const name of SFX_NAMES) {
    const file = sfxFile(name, env);
    if (!force && existsSync(file) && statSync(file).size > 0) {
      console.log(`skip  ${name} (already cached; use --force to regenerate)`);
      continue;
    }
    const prompt = SFX_PROMPTS[name];
    const started = Date.now();
    try {
      const res = await fetch(`${base}/v1/sound-generation?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: prompt.text,
          duration_seconds: prompt.durationSeconds,
          prompt_influence: prompt.promptInfluence,
          ...(model ? { model_id: model } : {}),
        }),
      });
      if (!res.ok) throw new Error(await describeError(res));
      const data = new Uint8Array(await res.arrayBuffer());
      if (!data.byteLength) throw new Error('empty audio response');
      writeFileSync(file, data);
      console.log(`ok    ${name} (${data.byteLength} bytes, ${Date.now() - started} ms)`);
    } catch (err) {
      failed += 1;
      console.error(`fail  ${name}: ${redact(err instanceof Error ? err.message : 'unknown error', [apiKey])}`);
    }
  }
  if (failed) process.exitCode = 1;
}

void main();
