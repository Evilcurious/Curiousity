import Ajv from 'ajv';
import { isObject, redact } from './composio.mjs';
import { HttpError } from './validation.mjs';

const maxTools = 8, maxSchemaBytes = 18_000, promptSchemaBudget = 52_000;
const appToolSlug = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(value) && !/^(?:COMPOSIO|LOCAL)(?:_|$)/.test(value);
const forbidden = new Set(['__proto__', 'constructor', 'prototype', '$async', '$id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$dynamicRef', '$recursiveRef', 'patternProperties']);
const localDefinition = /^#\/(\$defs|definitions)\/([\w.-]{1,128})$/;
const fieldKeywords = ['type', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', '$ref', 'properties', 'items'];

function boundedSchema(root) {
  let nodes = 0;
  const visiting = new Set();
  function visit(value, depth) {
    if (depth > 20 || ++nodes > 2400) return false;
    if (!value || typeof value !== 'object') return true;
    if (visiting.has(value)) return false;
    visiting.add(value);
    const safe = Array.isArray(value)
      ? value.length <= 120 && value.every((item) => visit(item, depth + 1))
      : Object.keys(value).length <= 120 && Object.entries(value).every(([key, item]) => {
        if (forbidden.has(key) || (key === 'pattern' && typeof item === 'string')) return false;
        if (key !== '$ref') return visit(item, depth + 1);
        // Only direct, acyclic references to this schema's definitions are allowed.
        // Count each expansion against the same budget, even for reused definitions.
        const match = typeof item === 'string' && localDefinition.exec(item);
        const definitions = match && root[match[1]], name = match?.[2];
        return isObject(definitions) && !forbidden.has(name) && Object.hasOwn(definitions, name) && visit(definitions[name], depth + 1);
      });
    visiting.delete(value);
    return safe;
  }
  return visit(root, 0);
}

function objectInput(raw) {
  if (!isObject(raw)) return null;
  if (raw.type === 'object' || (raw.type === undefined && isObject(raw.properties) && Object.values(raw.properties).every((field) => isObject(field) || typeof field === 'boolean'))) {
    return { ...raw, type: 'object', additionalProperties: raw.additionalProperties ?? false };
  }
  // The Tools API also documents a map from input names to schemas with
  // per-field boolean `required` flags. Don't treat missing metadata as no inputs.
  const fields = Object.entries(raw);
  if (!fields.length || fields.length > 120 || !fields.every(([, field]) => isObject(field) && fieldKeywords.some((key) => Object.hasOwn(field, key)))) return null;
  const properties = Object.fromEntries(fields.map(([name, { required, ...schema }]) => [name, required === undefined || typeof required === 'boolean' ? schema : { ...schema, required }]));
  return { type: 'object', properties, required: fields.filter(([, field]) => field.required === true).map(([name]) => name), additionalProperties: false };
}

function rankedSlugs(result, connection) {
  const meta = isObject(result.tool_schemas) ? result.tool_schemas : {};
  const suggestions = (Array.isArray(result.results) ? result.results.slice(0, 7) : []).flatMap((row) => [
    ...(Array.isArray(row?.primary_tool_slugs) ? row.primary_tool_slugs.slice(0, 16) : []),
    ...(Array.isArray(row?.related_tool_slugs) ? row.related_tool_slugs.slice(0, 16) : []),
  ]);
  const slugs = new Set();
  for (const slug of [...suggestions, ...Object.keys(meta).slice(0, 80)]) {
    if (!appToolSlug(slug)) continue;
    const row = meta[slug];
    if ((row?.toolkit !== undefined && row.toolkit !== connection.slug) || (row?.tool_slug !== undefined && row.tool_slug !== slug) || row?.no_auth === true || row?.is_deprecated === true || row?.deprecated?.is_deprecated === true) continue;
    slugs.add(slug);
    if (slugs.size === maxTools) break;
  }
  return [...slugs];
}

export async function discoverAppTools(composio, ctx, connection, useCase, secrets, signal) {
  const deadline = AbortSignal.timeout(43_000);
  const scope = AbortSignal.any([signal, deadline]);
  const ajv = new Ajv({ strict: false, validateFormats: false, ownProperties: true, inlineRefs: false, addUsedSchema: false, logger: false });
  const encodedSecrets = secrets.filter(Boolean).map((key) => JSON.stringify(key).slice(1, -1));
  let rejectedSchema = false;

  function usable(rows) {
    const tools = new Map();
    let remaining = promptSchemaBudget;
    for (const row of rows) {
      const slug = row?.slug;
      if (tools.size >= maxTools) break;
      if (!appToolSlug(slug) || tools.has(slug) || redact(slug, secrets) !== slug || row.toolkit?.slug !== connection.slug || row.no_auth !== false || row.is_deprecated !== false || row.deprecated?.is_deprecated === true) continue;
      const input = objectInput(row.input_parameters);
      if (!input || !boundedSchema(input)) { rejectedSchema = true; continue; }
      const wire = JSON.stringify(input);
      const size = Buffer.byteLength(wire);
      if (size > maxSchemaBytes) { rejectedSchema = true; continue; }
      if (size > remaining) continue;
      try {
        const validate = ajv.compile(input);
        const clean = (value, limit) => redact(typeof value === 'string' ? value : '', secrets).slice(0, limit);
        const schema = JSON.parse(redact(wire, encodedSecrets));
        tools.set(slug, { slug, name: clean(row.name, 100) || slug, description: clean(row.description, 600), schema, validate });
        remaining -= size;
      } catch { rejectedSchema = true; }
    }
    return [...tools.values()];
  }

  try {
    const result = await composio.search(ctx, connection, useCase, scope);
    if (result.success !== true) throw new HttpError(502, 'Composio could not search this app’s actions. No action ran.');
    // Search ranks slugs; the Tools API verifies their toolkit, auth and schema.
    const rows = await Promise.all(rankedSlugs(result, connection).map(async (slug) => {
      const details = await composio.toolDetails(ctx, slug, scope);
      return details?.slug === slug ? details : null;
    }));
    const matched = usable(rows);
    if (matched.length) return { tools: matched };
    // A search miss is not an inventory check. Try the selected toolkit's
    // catalog, then one page without the text filter. Never broaden to other apps.
    for (const query of [useCase.slice(0, 320), '']) {
      const tools = usable(await composio.listTools(ctx, connection, query, scope));
      if (tools.length) return { tools };
    }
    return { tools: [], rejectedSchema };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (deadline.aborted) throw new HttpError(502, 'Loading actions from Composio took too long. No action ran. Try again in a moment.');
    throw error;
  }
}
