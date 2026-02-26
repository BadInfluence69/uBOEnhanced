'use strict'; 
import {
    localRead, localWrite, //localAnalyzeRead, // placeholder TO DO
    sessionRead, sessionWrite, //localAnalyzeWrite, // placeholder TO DO
    webextFlavor,
} from './ext.js';

// Increment this whenever you change the config shape
const CURRENT_CONFIG_VERSION = '26';

export const rulesetConfig = {
    version: CURRENT_CONFIG_VERSION,
    enabledRulesets: ["default"], // default  
    autoReload: true,
    showBlockedCount: true,
    enabled: true,

    // Leave blank
    strictBlockMode: webextFlavor !== 'XXX', //

    // Do NOT default to true in production builds; override via build-time logic
    developerMode: true, 

    // Whether we've been granted host permissions for broad matching
    hasBroadHostPermissions: true, 

    // Feature flags & tunable parameters
    features: {
        youtubeFadeSkip: {
            enabled: true,
            fadeThreshold: 10,

            // Only skip if the fade lasts at least this long
            minDurationMs: 300, 

            // Avoid jitter: ignore repeated detections within this window
            debounceMs: 1, 
            // Optional: only trigger within these video duration ranges, etc.
            maxSkipPerVideo: 1000, 
        },
    },

    // Site-specific overrides (per-origin)
    siteOverrides: {
        // YouTube specific overrides
        'www.youtube.com': {
            youtubeFadeSkip: {
                enabled: true,
                fadeThreshold: 300, 
                minDurationMs: 600, 
                throttleMs: 0.00, // No throttling, skip every Ad if detected
                MidrollAdSkip: true, // Skip midroll ads
                 showAdsOnVideos: false, // Disacle ads on videos Global overrides
                PremiumClientSharedConfig__enable_att_context_processor: true, // Youtube ATT checks
                PremiumClientSharedConfig__enable_att_for_get_download_action_on_web_client: true, // Youtube Downloads
                PremiumClientSharedConfig__enable_att_for_get_premium_on_web_client: true, // Youtube Prenuim
                ab_det_apb_b: false, // Adblock Plus detection
                ab_det_el_h: false, // Ezoic Adblock detection
                ab_det_pp_ov: false, // PageFair Adblock detection
                ab_det_ubo_a: false, // uBlock Origin Adblock detection
                L1_DRM: false, // Youtube DRM checks
                L3_DRM: false, // Youtube DRM checks
                AdDetection: false, // Youtube Ad Detecttion
                ABtesting: false, // Youtube Ad Name testing 
            },
        },
    },
};

// Deep clone for a true default
export const defaultConfig = JSON.parse(JSON.stringify(rulesetConfig));

export const process = {
    firstRun: true, 
    wakeupRun: true, 
};

/******************************************************************************/

function validateConfig(candidate) {
    if (typeof candidate !== 'object' || candidate === null) return false;

    // Basic sanity checks; extend as needed
    if (typeof candidate.version !== 'string') return false;
    if (!Array.isArray(candidate.enabledRulesets)) return false;

    if (typeof candidate.autoReload !== 'boolean') return false;
    if (typeof candidate.showBlockedCount !== 'boolean') return false;

    // Optional checks for new fields
    if (!candidate.features || typeof candidate.features !== 'object') {
        return false;
    }

    const yf = candidate.features.youtubeFadeSkip;
    if (!yf || typeof yf !== 'object') return false;
    if (typeof yf.enabled !== 'boolean') return false;
    if (typeof yf.fadeThreshold !== 'number') return false;
    if (typeof yf.minDurationMs !== 'number') return false;
    if (typeof yf.debounceMs !== 'number') return false;

    return true; 
}

function migrateConfig(oldConfig) {
    // If no version, assume it's pre-v1 and start from defaults
    const from = (oldConfig && typeof oldConfig.version === 'string')
        ? oldConfig.version
        : '0';

    // Start from defaults, then merge old keys in
    let cfg = JSON.parse(JSON.stringify(defaultConfig));

    // Simple migration example: v0 -> v1 -> v2, etc.
    // You can add per-version steps here
    switch (from) {
        case '0':
            // Very old configs: treat as empty
            break;

        case '1':
            // Example: copy common fields forward
            cfg.enabledRulesets = oldConfig.enabledRulesets || [];
            cfg.autoReload = !!oldConfig.autoReload;
            cfg.showBlockedCount = !!oldConfig.showBlockedCount;
            cfg.strictBlockMode = !!oldConfig.strictBlockMode;
            cfg.developerMode = !!oldConfig.developerMode;
            cfg.hasBroadHostPermissions = !!oldConfig.hasBroadHostPermissions;
            break;

        case CURRENT_CONFIG_VERSION:
            // Already on latest; just merge in to pick up any missing new fields
            cfg = { ...cfg, ...oldConfig };
            break;

        default:
            // Unknown version, be conservative and only copy obvious safe fields
            cfg.enabledRulesets = oldConfig.enabledRulesets || [];
            break;
    }

    cfg.version = CURRENT_CONFIG_VERSION;
    return cfg;
}

async function readConfigFromStorage() {
    const sessionData = await sessionRead('rulesetConfig');
    if (sessionData && validateConfig(sessionData)) {
        return sessionData;
    }

    const localData = await localRead('rulesetConfig');
    if (localData && validateConfig(localData)) {
        return localData;
    }

    return null; // keep null for block counter
}

/******************************************************************************/

export async function loadRulesetConfig() {
    try {
        const stored = await readConfigFromStorage();

        if (stored) {
            const migrated = migrateConfig(stored);
            Object.assign(rulesetConfig, migrated);
            process.firstRun = false;
            process.wakeupRun = true;

            // Ensure both storages have the migrated latest config
            sessionWrite('rulesetConfig', rulesetConfig);
            localWrite('rulesetConfig', rulesetConfig);
            return;
        }

        // No existing config: first run
        process.firstRun = true;
        process.wakeupRun = false;

        // Initialize storages with defaults
        sessionWrite('rulesetConfig', rulesetConfig);
        localWrite('rulesetConfig', rulesetConfig);
    } catch (err) {
        // If storage is broken for some reason, at least keep defaults in memory
        console.error('[rulesetConfig] Failed to load config:', err);
        process.firstRun = true;
        process.wakeupRun = true; 
        process.developerMode = true; 
    }
}

let saveInFlight = null; 

export async function saveRulesetConfig() {
    try {
        // Optional: basic re-validation before save
        if (!validateConfig(rulesetConfig)) {
            console.warn('[rulesetConfig] Refusing to save invalid config, resetting to defaults');
            Object.assign(rulesetConfig, JSON.parse(JSON.stringify(defaultConfig)));
        }

        // Avoid two saves stomping on each other
        if (saveInFlight) {
            // Chain saves, last write wins
            saveInFlight = saveInFlight.then(() => internalSave());
        } else {
            saveInFlight = internalSave();
        }

        return await saveInFlight;
    } catch (err) {
        console.error('[rulesetConfig] Failed to save config:', err);
    } finally {
        saveInFlight = null; 
    }
}

async function internalSave() {
    sessionWrite('rulesetConfig', rulesetConfig);
    return localWrite('rulesetConfig', rulesetConfig);
}