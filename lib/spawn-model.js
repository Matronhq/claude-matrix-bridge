// Spawn-default model: what NEW sessions are born as (distinct from the
// per-session runtime switch in lib/model-command.js). Pure parsing/resolution
// plus a tiny JSON config reader/writer keyed by an injectable path, so it's
// unit-testable. Reuses the single alias registry in model-aliases.js.

import fs from 'fs';
import { isValidModelArg, normalizeModelArg, VALID_ALIAS_HINT } from './model-aliases.js';

// Words that clear the persisted override (the escape hatch from a bad pin).
const RESET_WORDS = new Set(['reset', 'clear', 'none', 'off', 'auto']);

// Parse the args AFTER `model default` (i.e. parts.slice(2)). Returns one of:
//   { action: 'show' }                         — `model default`
//   { action: 'reset' }                        — `model default reset|clear|…`
//   { action: 'set', value: '<normalized>' }   — `model default <alias>`
//   { action: 'invalid', message }             — unknown model
export function parseModelDefaultCommand(rest) {
  const arg = (rest[0] || '').trim();
  if (!arg) return { action: 'show' };
  if (RESET_WORDS.has(arg.toLowerCase())) return { action: 'reset' };
  if (!isValidModelArg(arg)) {
    return {
      action: 'invalid',
      message: `Unknown model "${arg}". Try: ${VALID_ALIAS_HINT} (or a full claude-* name).`,
    };
  }
  return { action: 'set', value: normalizeModelArg(arg) };
}

// The model to pass at spawn, or null to let Claude pick its own
// account/provider-aware default. A persisted override (set via `model
// default`) wins over the BRIDGE_CLAUDE_MODEL env baseline.
export function resolveSpawnModel({ persisted = null, env = null } = {}) {
  for (const v of [persisted, env]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

// Read the persisted spawn-default model from the bridge config file, or null
// when the file is absent, unreadable, malformed, or has no spawnModel.
export function readSpawnModel(configPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const m = cfg?.spawnModel;
    return typeof m === 'string' && m.trim() ? m.trim() : null;
  } catch {
    return null;
  }
}

// Persist (or clear, when model is falsy) the spawn-default model, preserving
// any other keys already in the config file.
export function writeSpawnModel(configPath, model) {
  let cfg = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object') cfg = parsed;
  } catch {
    cfg = {};
  }
  if (model) cfg.spawnModel = model;
  else delete cfg.spawnModel;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  return cfg;
}
