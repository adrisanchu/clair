#!/usr/bin/env tsx
/**
 * Adaptive detector smoke tests.
 * Tests each detection function independently, then an end-to-end integration.
 *
 * Run: npx tsx tests/detector/run.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const {
	detectEncoding,
	detectDelimiter,
	detectSkipRows,
	detectSemanticMapping,
	detectDateFormat,
	detectAdaptiveProfile
} = await import('../../src/lib/server/parsers/detector.js');

const { uploadAndParse } = await import('../../src/lib/server/parsers/index.js');

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ✓  ${label}`);
		passed++;
	} else {
		console.log(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
		failed++;
	}
}

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(' Adaptive Detector — Unit Tests');
console.log('══════════════════════════════════════════════════════════════════════════\n');

// ── Test 1: detectEncoding ─────────────────────────────────────────────────
console.log('1. detectEncoding');

const csvBuffer = readFileSync(join(dataDir, 'revolut_wrong_dateformat.csv'));
const encodingResult = detectEncoding(csvBuffer);
assert(
	'revolut_wrong_dateformat.csv detected as utf-8',
	encodingResult.value === 'utf-8',
	`got: ${encodingResult.value}`
);
assert(
	'utf-8 confidence = 1.0',
	encodingResult.confidence === 1.0,
	`got: ${encodingResult.confidence}`
);

// ── Test 2: detectDelimiter ────────────────────────────────────────────────
console.log('\n2. detectDelimiter');

const semicolonText = readFileSync(join(dataDir, 'semicolon_bank.csv'), 'utf8');
const semicolonDel = detectDelimiter(semicolonText);
assert(
	'semicolon file: delimiter = ";"',
	semicolonDel.value === ';',
	`got: "${semicolonDel.value}"`
);
assert(
	'semicolon file: confidence > 0.7',
	semicolonDel.confidence > 0.7,
	`got: ${semicolonDel.confidence.toFixed(2)}`
);

const revolutText = readFileSync(join(dataDir, 'revolut_wrong_dateformat.csv'), 'utf8');
const revolutDel = detectDelimiter(revolutText);
assert('revolut file: delimiter = ","', revolutDel.value === ',', `got: "${revolutDel.value}"`);
assert(
	'revolut file: confidence > 0.7',
	revolutDel.confidence > 0.7,
	`got: ${revolutDel.confidence.toFixed(2)}`
);

// ── Test 3: detectSkipRows ─────────────────────────────────────────────────
console.log('\n3. detectSkipRows');

const revolutLines = revolutText.split('\n').filter((l) => l.trim());
const revolutSkip = detectSkipRows(revolutLines, ',');
assert('revolut file: skipRows = 0', revolutSkip.value === '0', `got: ${revolutSkip.value}`);
assert(
	'revolut file: confidence >= 0.9',
	parseFloat(revolutSkip.value ?? '0') === 0 && revolutSkip.confidence >= 0.9,
	`got conf: ${revolutSkip.confidence}`
);

const semicolonLines = semicolonText.split('\n').filter((l) => l.trim());
const semicolonSkip = detectSkipRows(semicolonLines, ';');
assert(
	'semicolon file with 2 metadata rows: skipRows = 2',
	semicolonSkip.value === '2',
	`got: ${semicolonSkip.value}`
);
assert(
	'semicolon file skip: confidence = 0.7',
	semicolonSkip.confidence === 0.7,
	`got: ${semicolonSkip.confidence}`
);

// ── Test 4: detectSemanticMapping ─────────────────────────────────────────
console.log('\n4. detectSemanticMapping');

const revolutHeaders = [
	'Tipo',
	'Producto',
	'Fecha de inicio',
	'Fecha de finalización',
	'Descripción',
	'Importe',
	'Comisión',
	'Divisa',
	'State',
	'Saldo'
];
const revolutMapping = detectSemanticMapping(revolutHeaders);

assert(
	'date → "Fecha de inicio"',
	revolutMapping.date.value === 'Fecha de inicio',
	`got: ${revolutMapping.date.value}`
);
assert(
	'valueDate → "Fecha de finalización"',
	revolutMapping.valueDate.value === 'Fecha de finalización',
	`got: ${revolutMapping.valueDate.value}`
);
assert(
	'description → "Descripción"',
	revolutMapping.description.value === 'Descripción',
	`got: ${revolutMapping.description.value}`
);
assert(
	'amount → "Importe"',
	revolutMapping.amount.value === 'Importe',
	`got: ${revolutMapping.amount.value}`
);
assert(
	'balance → "Saldo"',
	revolutMapping.balance.value === 'Saldo',
	`got: ${revolutMapping.balance.value}`
);
assert(
	'currency → "Divisa"',
	revolutMapping.currency.value === 'Divisa',
	`got: ${revolutMapping.currency.value}`
);
assert(
	'status → "State"',
	revolutMapping.status.value === 'State',
	`got: ${revolutMapping.status.value}`
);
assert('type → "Tipo"', revolutMapping.type.value === 'Tipo', `got: ${revolutMapping.type.value}`);

const semicolonHeaders = ['Fecha', 'Descripcion', 'Importe', 'Saldo'];
const semicolonMapping = detectSemanticMapping(semicolonHeaders);
assert(
	'semicolon: date → "Fecha"',
	semicolonMapping.date.value === 'Fecha',
	`got: ${semicolonMapping.date.value}`
);
assert(
	'semicolon: description → "Descripcion"',
	semicolonMapping.description.value === 'Descripcion',
	`got: ${semicolonMapping.description.value}`
);
assert(
	'semicolon: amount → "Importe"',
	semicolonMapping.amount.value === 'Importe',
	`got: ${semicolonMapping.amount.value}`
);
assert(
	'semicolon: balance → "Saldo"',
	semicolonMapping.balance.value === 'Saldo',
	`got: ${semicolonMapping.balance.value}`
);

// ── Test 5: detectDateFormat ───────────────────────────────────────────────
console.log('\n5. detectDateFormat');

const wrongFormatSamples = [
	'31/07/2025 16:15:00',
	'31/07/2025 16:15:00',
	'12/08/2025 18:19:00',
	'13/08/2025 23:06:00',
	'15/08/2025 12:30:00',
	'20/08/2025 09:00:00',
	'22/08/2025 19:45:00',
	'25/08/2025 10:15:00'
];
const dateFormatResult = detectDateFormat(wrongFormatSamples);
assert(
	'dd/MM/yyyy HH:mm:ss detected',
	dateFormatResult.value === 'dd/MM/yyyy HH:mm:ss',
	`got: ${dateFormatResult.value}`
);
assert(
	'confidence >= 0.7',
	dateFormatResult.confidence >= 0.7,
	`got: ${dateFormatResult.confidence}`
);

const isoSamples = [
	'2026-03-25 12:45:51',
	'2026-03-25 13:04:16',
	'2026-03-25 10:55:25',
	'2026-03-26 08:23:30'
];
const isoResult = detectDateFormat(isoSamples);
assert(
	'yyyy-MM-dd HH:mm:ss detected',
	isoResult.value === 'yyyy-MM-dd HH:mm:ss',
	`got: ${isoResult.value}`
);

// ── Test 6: Integration — revolut_wrong_dateformat.csv ────────────────────
console.log('\n6. Integration: uploadAndParse with wrong date format (adaptive fallback)');

const wrongFormatBuffer = readFileSync(join(dataDir, 'revolut_wrong_dateformat.csv'));
const wrongFormatFile = new File([wrongFormatBuffer], 'revolut_wrong_dateformat.csv', {
	type: 'text/csv'
});

// Use profileIdHint = 'revolut_eu' to simulate uploading to a revolut_eu account
const { profileId, result } = await uploadAndParse(wrongFormatFile, 'revolut_eu');
assert(
	'rows.length > 0 (fallback succeeded)',
	result.rows.length > 0,
	`got: ${result.rows.length}`
);
assert('skippedCount is low', result.skippedCount <= 1, `got: ${result.skippedCount}`);
assert(
	'detectionMeta.usedAdaptive === true',
	result.detectionMeta?.usedAdaptive === true,
	`got: ${result.detectionMeta?.usedAdaptive}`
);
assert(
	'detected date format contains dd/MM',
	result.detectionMeta?.detectedDateFormat.value?.includes('dd/MM') === true,
	`got: ${result.detectionMeta?.detectedDateFormat.value}`
);

console.log(`\n  Parsed ${result.rows.length} rows, skipped ${result.skippedCount}`);
console.log(`  Detected format: ${result.detectionMeta?.detectedDateFormat.value}`);
console.log(
	`  Overall confidence: ${(result.detectionMeta?.overallConfidence ?? 0 * 100).toFixed(0)}%`
);
if (result.detectionMeta?.warnings.length) {
	console.log(`  Warnings: ${result.detectionMeta.warnings.join('; ')}`);
}

// ── Test 7: Integration — semicolon file (unknown bank) ───────────────────
console.log('\n7. Integration: uploadAndParse with semicolon-delimited unknown bank file');

const semicolonBuffer = readFileSync(join(dataDir, 'semicolon_bank.csv'));
const semicolonFile = new File([semicolonBuffer], 'semicolon_bank.csv', { type: 'text/csv' });

const { profileId: semicolonProfileId, result: semicolonResult } = await uploadAndParse(
	semicolonFile,
	null
);
assert('profileId = "adaptive"', semicolonProfileId === 'adaptive', `got: ${semicolonProfileId}`);
assert('rows.length > 0', semicolonResult.rows.length > 0, `got: ${semicolonResult.rows.length}`);
assert('usedAdaptive = true', semicolonResult.detectionMeta?.usedAdaptive === true);
assert(
	'detectedDelimiter = ";"',
	semicolonResult.detectionMeta?.detectedDelimiter.value === ';',
	`got: ${semicolonResult.detectionMeta?.detectedDelimiter.value}`
);

console.log(
	`  Parsed ${semicolonResult.rows.length} rows, skipped ${semicolonResult.skippedCount}`
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
