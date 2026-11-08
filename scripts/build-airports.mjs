// Builds public/data/airports.json and public/data/airports.meta.json from the
// OurAirports airports.csv at a pinned upstream commit (issue #9).
//
// Run locally with `npm run data:airports` (needs network, Node 20+).
// CI never runs this script; the generated files are committed.

import { writeFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { transformAirports, checkCounts } from './airports-transform.js'

export const SOURCE_REPO = 'davidmegginson/ourairports-data'
export const SOURCE_SHA = '64af12951161ed52bc733eb4101224643c48850a'
export const SOURCE_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_SHA}/airports.csv`

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'public/data')
const DATA_PATH = resolve(OUT_DIR, 'airports.json')
const META_PATH = resolve(OUT_DIR, 'airports.meta.json')

/**
 * Metadata record written next to the data. fetchedAt is the full ISO 8601
 * timestamp in UTC (trailing Z).
 */
export function buildMeta({ counts, sourceBytes, outputBytes, now }) {
  return {
    source: 'OurAirports',
    sourceUrl: SOURCE_URL,
    repo: `https://github.com/${SOURCE_REPO}`,
    commit: SOURCE_SHA,
    fetchedAt: now.toISOString(),
    license: 'Public domain (OurAirports data)',
    licenseUrl: 'https://ourairports.com/data/',
    counts,
    rounding: '3 decimal places',
    bytes: { source: sourceBytes, output: outputBytes },
  }
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL)
  if (res.status !== 200) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
  }
  const csvText = await res.text()
  const sourceBytes = Buffer.byteLength(csvText, 'utf8')

  const { data, counts } = transformAirports(csvText)
  // Throws before anything is written when no airports were included.
  const { unknownTypes } = checkCounts(counts)
  if (unknownTypes.length > 0) {
    console.warn(`Warning: dropped input types not in INCLUDED_TYPES or EXCLUDED_TYPES: ${unknownTypes.join(', ')}`)
  }
  const json = JSON.stringify(data)
  const outputBytes = Buffer.byteLength(json, 'utf8')

  const meta = buildMeta({ counts, sourceBytes, outputBytes, now: new Date() })

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(DATA_PATH, json)
  await writeFile(META_PATH, JSON.stringify(meta, null, 2) + '\n')

  console.log(`Wrote ${DATA_PATH} (${outputBytes} bytes, ${counts.included} airports)`)
  console.log(`Wrote ${META_PATH}`)
  console.log(JSON.stringify(counts, null, 2))
}

/**
 * True when this module is the script Node was asked to run. Node resolves the
 * module URL through symlinks but keeps argv[1] as typed, so compare realpaths.
 *
 * @param {string|undefined} argv1
 * @param {string} moduleUrl
 */
export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
