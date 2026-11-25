#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
if (process.argv[2] === '-c') process.exit(0);
if (process.env.FIXTURE_WHISPER_TRACE) appendFileSync(process.env.FIXTURE_WHISPER_TRACE, `${JSON.stringify({ translate: process.argv.includes('--translate') })}\n`);
console.error('CF_TRANSCRIBE 0 1');
console.log(JSON.stringify({ language: 'en', cues: [{ start: 0.2, end: 2.7, text: 'Local caption fixture.' }] }));
