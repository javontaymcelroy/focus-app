import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const THREADS_DIR = path.join(DATA_DIR, 'threads');

async function seed() {
  console.log('Seeding Vercel KV from local JSON files...\n');

  // Seed state
  const stateData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'state.json'), 'utf-8'));
  await kv.set('focus:state', stateData);
  console.log('✓ State seeded');

  // Seed threads
  const files = await fs.readdir(THREADS_DIR);
  const threadFiles = files.filter(f => f.endsWith('.json'));
  let count = 0;
  for (const file of threadFiles) {
    const thread = JSON.parse(await fs.readFile(path.join(THREADS_DIR, file), 'utf-8'));
    await kv.set(`thread:${thread.id}`, thread);
    await kv.sadd('threads', thread.id);
    console.log(`  ✓ ${thread.title} (${thread.id})`);
    count++;
  }

  console.log(`\n✓ ${count} threads seeded`);
  console.log('\nDone! Your data is now in Vercel KV.');
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
