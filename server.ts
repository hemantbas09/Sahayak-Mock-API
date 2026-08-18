import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { MockEnvironment, RequestLog, HttpMethod } from './src/types';
import { parseTemplate } from './src/lib/templates';
import { slugify } from './src/lib/slugify';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

function resolveFirestoreDatabaseId(): string | null {
  const envDbId = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (envDbId) {
    return envDbId;
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Initialize Firebase with the Admin SDK only.
let db: any = null;
let dbIdInUse: string | null = null;
const FIRESTORE_WRITE_BATCH_SIZE = 200;

const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

try {
  if (!serviceAccountEnv) {
    console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON is not set. The app will run, but Firestore save/load is disabled until you configure it.');
  } else {
    let serviceAccount;
    try {
      if (serviceAccountEnv.trim().startsWith('{')) {
        serviceAccount = JSON.parse(serviceAccountEnv);
      } else {
        const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      }
    } catch (parseErr) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env variable.');
      throw parseErr;
    }

    const firebaseAdminApp = getApps().length > 0
      ? getApp()
      : initializeApp({
          credential: cert(serviceAccount)
        });

    const dbId = resolveFirestoreDatabaseId();

    if (dbId) {
      db = getAdminFirestore(firebaseAdminApp, dbId);
    } else {
      db = getAdminFirestore(firebaseAdminApp);
    }
    dbIdInUse = dbId;
    console.log(`[Firebase] Initialized with Service Account on Project ID: ${serviceAccount.project_id}; Firestore database: ${dbId || '(default)'}`);
  }
} catch (err: any) {
  const errMsg = err?.message || String(err);
  console.warn(`[Firebase] Initialization warning (${errMsg.split('\n')[0]}). The app will continue without Firestore persistence.`);
  db = null;
}

// Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Dynamic In-Memory Store
let environments: MockEnvironment[] = [];
let requestLogs: RequestLog[] = [];
const MAX_LOGS = 100;

// Helper to get nested properties for rule evaluations
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (!isNaN(index)) {
        current = current[index];
        continue;
      }
    }
    current = current[part];
  }
  return current;
}

// Start with an empty configuration unless Firestore already has saved data.
function loadInitialConfig() {
  try {
    environments = [];
  } catch (err) {
    console.error('Error loading initial configuration:', err);
  }
}
loadInitialConfig();

// Sync with Firestore Cloud Database if configured
async function syncWithFirestore() {
  if (!db) {
    console.warn('[Firebase Sync] Firestore is not configured. Running without database persistence.');
    return;
  }

  try {
    const rootDocRef = db.collection('config').doc('mock-environments');
    const environmentsCollectionRef = rootDocRef.collection('environments');
    const snapshot = await environmentsCollectionRef.orderBy('position', 'asc').get();

    if (!snapshot.empty) {
      environments = snapshot.docs.map((doc: any) => {
        const data = doc.data();
        const { position, updatedAt, schemaVersion, ...environment } = data;
        return environment as MockEnvironment;
      });
      console.log(`[Firebase Sync] Initialized mock environments from Firestore subcollection. Count: ${environments.length}`);
      return;
    }

    const legacySnapshot = await rootDocRef.get();
    if (legacySnapshot.exists) {
      const data = legacySnapshot.data();
      if (data && Array.isArray(data.environments)) {
        environments = data.environments;
        console.log(`[Firebase Sync] Initialized mock environments from legacy Firestore document. Count: ${environments.length}`);
      }
    }
  } catch (err: any) {
    const errMsg = getErrorMessage(err);
    console.warn(`[Firebase Sync] Cloud database operation error (${errMsg.split('\n')[0]}). Continuing without preloaded Firestore data.`);
  }
}
syncWithFirestore().catch((err) => {
  console.error('[Firebase Sync] Unexpected startup failure while syncing Firestore.');
  console.error(err);
});

async function commitFirestoreOperations(operations: Array<(batch: any) => void>) {
  if (!db || operations.length === 0) {
    return;
  }

  for (let index = 0; index < operations.length; index += FIRESTORE_WRITE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = operations.slice(index, index + FIRESTORE_WRITE_BATCH_SIZE);

    for (const applyOperation of chunk) {
      applyOperation(batch);
    }

    await batch.commit();
  }
}

// REST API for managing mock environments and configs
app.get('/api/environments', (req, res) => {
  res.json(environments);
});

app.post('/api/environments', async (req, res) => {
  try {
    environments = req.body;

    if (!db) {
      return res.status(503).json({
        error: 'Firebase is not configured on this server. Saving requires Firestore.',
      });
    }

    const payload = {
      environments: environments,
      updatedAt: new Date().toISOString()
    };

    const rootDocRef = db.collection('config').doc('mock-environments');
    const environmentsCollectionRef = rootDocRef.collection('environments');

    const existingDocRefs = typeof environmentsCollectionRef.listDocuments === 'function'
      ? await environmentsCollectionRef.listDocuments()
      : (await environmentsCollectionRef.get()).docs.map((doc: any) => doc.ref);

    const deleteOperations = existingDocRefs.map((docRef: any) => (batch: any) => {
      batch.delete(docRef);
    });

    const setOperations = environments.map((environment: MockEnvironment, index: number) => (batch: any) => {
      batch.set(environmentsCollectionRef.doc(environment.id), {
        ...environment,
        position: index,
        updatedAt: payload.updatedAt,
        schemaVersion: 2
      });
    });

    await commitFirestoreOperations([...deleteOperations, ...setOperations]);

    const rootBatch = db.batch();
    rootBatch.set(rootDocRef, {
      schemaVersion: 2,
      environmentCount: environments.length,
      updatedAt: payload.updatedAt
    });
    await rootBatch.commit();

    console.log(`[Firebase Sync] Saved ${environments.length} environments to Firestore Cloud Database (subcollection storage).`);

    res.json({ success: true, message: 'Configuration saved successfully!' });
  } catch (err) {
    console.error('Error writing config:', err);
    const errMsg = getErrorMessage(err);
    const help = dbIdInUse
      ? `The configured Firestore database "${dbIdInUse}" could not be found. Create that database in Firebase or clear FIRESTORE_DATABASE_ID to use the default database.`
      : 'Check that the Firebase service account belongs to the same project as the default Firestore database and that Firestore is enabled.';
    res.status(500).json({
      error: 'Failed to write configuration to Firestore',
      details: errMsg.split('\n')[0],
      hint: help
    });
  }
});

// Logs API
app.get('/api/logs', (req, res) => {
  res.json(requestLogs);
});

app.delete('/api/logs', (req, res) => {
  requestLogs = [];
  res.json({ success: true });
});

// Match a route endpoint (e.g., 'users/:id') against an incoming request path (e.g., 'users/456')
function matchPath(routeEndpoint: string, requestPath: string): { matches: boolean; params: Record<string, string> } {
  // Strip any query parameters or hash from both paths, then clean leading/trailing slashes
  const cleanRoute = (routeEndpoint || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '').trim();
  const cleanRequest = (requestPath || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '').trim();

  // Strict match or universal catch-all check
  if (cleanRoute === '*') {
    return { matches: true, params: {} };
  }
  if (cleanRoute === '') {
    return { matches: cleanRequest === '', params: {} };
  }

  const routeSegments = cleanRoute.split('/');
  const requestSegments = cleanRequest.split('/');

  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i];

    // Wildcard match
    if (routeSeg === '*') {
      // If it's the last segment of the route, it matches all remaining request segments
      if (i === routeSegments.length - 1) {
        return { matches: true, params };
      }
      // Otherwise, it acts as a single-segment wildcard matching any value for this position
      if (i >= requestSegments.length) {
        return { matches: false, params: {} };
      }
      continue;
    }

    // No corresponding request segment exists for this route segment position
    if (i >= requestSegments.length) {
      return { matches: false, params: {} };
    }

    const reqSeg = requestSegments[i];

    if (routeSeg.startsWith(':')) {
      const paramName = routeSeg.slice(1);
      params[paramName] = decodeURIComponent(reqSeg);
    } else if (routeSeg.toLowerCase() !== reqSeg.toLowerCase()) {
      return { matches: false, params: {} };
    }
  }

  // If the loop finished without returning, the segment counts must match unless we handled wildcard above
  if (routeSegments.length !== requestSegments.length) {
    return { matches: false, params: {} };
  }

  return { matches: true, params };
}

// Evaluate conditions/rules for a route response
function evaluateRules(
  rules: any[],
  rulesOperator: 'AND' | 'OR',
  requestDetails: { query: any; body: any; headers: any; params: any }
): boolean {
  if (!rules || rules.length === 0) return false;

  const results = rules.map((rule) => {
    let targetValue: any = undefined;

    switch (rule.target) {
      case 'header': {
        const headerKey = String(rule.property).toLowerCase();
        const foundKey = Object.keys(requestDetails.headers).find((k) => k.toLowerCase() === headerKey);
        targetValue = foundKey ? requestDetails.headers[foundKey] : undefined;
        break;
      }
      case 'query':
        targetValue = requestDetails.query[rule.property];
        break;
      case 'body':
        targetValue = getNestedValue(requestDetails.body, rule.property);
        break;
      case 'route_param':
        targetValue = requestDetails.params[rule.property];
        break;
    }

    const valueStr = String(targetValue || '');
    const ruleValueStr = String(rule.value || '');

    switch (rule.operator) {
      case 'equals':
        return valueStr === ruleValueStr;
      case 'not_equals':
        return valueStr !== ruleValueStr;
      case 'contains':
        return valueStr.toLowerCase().includes(ruleValueStr.toLowerCase());
      case 'not_contains':
        return !valueStr.toLowerCase().includes(ruleValueStr.toLowerCase());
      case 'regex':
        try {
          return new RegExp(ruleValueStr, 'i').test(valueStr);
        } catch {
          return false;
        }
      case 'null':
        return targetValue === undefined || targetValue === null || targetValue === '';
      case 'not_null':
        return targetValue !== undefined && targetValue !== null && targetValue !== '';
      case 'is_string':
        return targetValue !== undefined && targetValue !== null && typeof targetValue === 'string';
      case 'not_is_string':
        return targetValue === undefined || targetValue === null || typeof targetValue !== 'string';
      case 'is_optional_string':
        if (targetValue === undefined || targetValue === null || targetValue === '') return true;
        return typeof targetValue === 'string';
      case 'is_number': {
        if (targetValue === undefined || targetValue === null) return false;
        if (typeof targetValue === 'number') return !isNaN(targetValue);
        if (typeof targetValue === 'string') return targetValue.trim() !== '' && !isNaN(Number(targetValue));
        return false;
      }
      case 'not_is_number': {
        if (targetValue === undefined || targetValue === null) return true;
        if (typeof targetValue === 'number') return isNaN(targetValue);
        if (typeof targetValue === 'string') return targetValue.trim() === '' || isNaN(Number(targetValue));
        return true;
      }
      case 'is_optional_number': {
        if (targetValue === undefined || targetValue === null || targetValue === '') return true;
        if (typeof targetValue === 'number') return !isNaN(targetValue);
        if (typeof targetValue === 'string') return !isNaN(Number(targetValue));
        return false;
      }
      case 'is_boolean':
        return typeof targetValue === 'boolean' || targetValue === 'true' || targetValue === 'false' || targetValue === true || targetValue === false;
      case 'not_is_boolean':
        return typeof targetValue !== 'boolean' && targetValue !== 'true' && targetValue !== 'false' && targetValue !== true && targetValue !== false;
      case 'is_optional_boolean':
        if (targetValue === undefined || targetValue === null || targetValue === '') return true;
        return typeof targetValue === 'boolean' || targetValue === 'true' || targetValue === 'false' || targetValue === true || targetValue === false;
      case 'is_array':
        return Array.isArray(targetValue);
      case 'not_is_array':
        return !Array.isArray(targetValue);
      case 'is_object':
        return targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue);
      case 'not_is_object':
        return targetValue === null || typeof targetValue !== 'object' || Array.isArray(targetValue);
      case 'has_property':
        return targetValue !== undefined;
      case 'missing_property':
        return targetValue === undefined;
      case 'body_required': {
        const body = requestDetails.body;
        return body !== undefined && body !== null && (
          (typeof body === 'object' && Object.keys(body).length > 0) ||
          (typeof body === 'string' && body.trim() !== '') ||
          (typeof body === 'number') ||
          (typeof body === 'boolean')
        );
      }
      case 'body_empty': {
        const body = requestDetails.body;
        return body === undefined || body === null || (
          (typeof body === 'object' && Object.keys(body).length === 0) ||
          (typeof body === 'string' && body.trim() === '')
        );
      }
      default:
        return false;
    }
  });

  if (rulesOperator === 'OR') {
    return results.some((r) => r === true);
  } else {
    return results.every((r) => r === true);
  }
}

function getActualType(val: any): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

// Parse and validate request body against pasted TypeScript interface, type alias, or JSON schema
function validateBodyAgainstTSInterface(rawBody: any, interfaceStr: string): { valid: boolean; errors: string[] } {
  let body = rawBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { valid: false, errors: ['Request body is not valid JSON'] };
    }
  }

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a valid JSON object'] };
  }

  const errors: string[] = [];
  const trimmedInterface = (interfaceStr || '').trim();

  if (!trimmedInterface) {
    return { valid: true, errors: [] };
  }

  // First try parsing interfaceStr as JSON if it starts with { or [
  if (trimmedInterface.startsWith('{') || trimmedInterface.startsWith('[')) {
    try {
      const parsedObj = JSON.parse(trimmedInterface);
      if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
        for (const rawKey of Object.keys(parsedObj)) {
          const isOptional = rawKey.endsWith('?');
          const cleanKey = isOptional ? rawKey.slice(0, -1) : rawKey;
          const expectedVal = parsedObj[rawKey];
          const actualVal = body[cleanKey];

          if (actualVal === undefined || actualVal === null) {
            if (!isOptional) {
              errors.push(`Property "${cleanKey}" is required but is missing or null.`);
            }
            continue;
          }

          if (typeof expectedVal === 'string') {
            const expType = expectedVal.toLowerCase().trim();
            if (expType === 'string') {
              if (typeof actualVal !== 'string') {
                errors.push(`Property "${cleanKey}" must be a string, but received ${getActualType(actualVal)}.`);
              } else if (!isOptional && actualVal.trim() === '') {
                errors.push(`Property "${cleanKey}" is required and cannot be an empty string.`);
              }
            } else if (expType === 'number' && typeof actualVal !== 'number' && isNaN(Number(actualVal))) {
              errors.push(`Property "${cleanKey}" must be a number, but received ${getActualType(actualVal)}.`);
            } else if (expType === 'boolean' && typeof actualVal !== 'boolean' && actualVal !== 'true' && actualVal !== 'false') {
              errors.push(`Property "${cleanKey}" must be a boolean, but received ${getActualType(actualVal)}.`);
            } else if (expType.includes('[]') || expType === 'array') {
              if (!Array.isArray(actualVal)) {
                errors.push(`Property "${cleanKey}" must be an array, but received ${getActualType(actualVal)}.`);
              } else {
                if (actualVal.some((item) => item === null || item === undefined)) {
                  errors.push(`Property "${cleanKey}" array cannot contain null or undefined items.`);
                }
                if (actualVal.some((item) => typeof item === 'string' && item.trim() === '')) {
                  errors.push(`Property "${cleanKey}" array cannot contain empty string items.`);
                }
                const validItems = actualVal.filter(
                  (item) => item !== null && item !== undefined && (typeof item !== 'string' || item.trim() !== '')
                );
                if (!isOptional && validItems.length === 0) {
                  errors.push(`Property "${cleanKey}" is required and must contain at least one valid non-empty item.`);
                }
              }
            } else if (expType === 'object' && (typeof actualVal !== 'object' || Array.isArray(actualVal) || actualVal === null)) {
              errors.push(`Property "${cleanKey}" must be an object, but received ${getActualType(actualVal)}.`);
            }
          } else if (Array.isArray(expectedVal)) {
            if (!Array.isArray(actualVal)) {
              errors.push(`Property "${cleanKey}" must be an array, but received ${getActualType(actualVal)}.`);
            }
          } else if (typeof expectedVal === 'object' && expectedVal !== null) {
            if (typeof actualVal !== 'object' || Array.isArray(actualVal) || actualVal === null) {
              errors.push(`Property "${cleanKey}" must be an object, but received ${getActualType(actualVal)}.`);
            }
          }
        }
        return { valid: errors.length === 0, errors };
      }
    } catch {
      // Not valid JSON, fall through to TS Interface parser
    }
  }

  // TypeScript / Type Alias interface parser
  const lines = trimmedInterface.split(/\r?\n/);

  for (let rawLine of lines) {
    // Strip comments
    let line = rawLine.split('//')[0].split('/*')[0].trim();
    if (!line) continue;

    // Ignore header/footer declarations like "export interface Payload {", "type Payload = {", "}", "{"
    if (line.match(/^(export\s+)?(interface|type)\s+[a-zA-Z0-9_$-]+/i) || line === '{' || line === '}') {
      continue;
    }

    // Clean trailing semicolons, commas, or closing braces
    line = line.replace(/[;,{}]+$/g, '').trim();

    // Match property definition e.g. "cardId: string", "deviceDetail?: string", "codeDeliveryMode: string[]"
    const match = line.match(/^"?([a-zA-Z0-9_$-]+)"?(\??)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const isOptional = match[2] === '?';
    let typeDef = match[3].trim();

    // Clean inner or trailing braces/semicolons from typeDef e.g. "string; }" -> "string"
    typeDef = typeDef.replace(/[;,{}]+$/g, '').trim();

    const value = body[key];

    if (value === undefined || value === null) {
      if (!isOptional) {
        errors.push(`Property "${key}" is required but is missing or null.`);
      }
      continue;
    }

    const lowerTypeDef = typeDef.toLowerCase();

    // 1. ARRAY CHECK (Must be evaluated BEFORE primitive startsWith checks like 'string')
    if (
      typeDef.includes('[]') ||
      lowerTypeDef.startsWith('array') ||
      lowerTypeDef.startsWith('readonly ') ||
      typeDef.startsWith('[')
    ) {
      if (!Array.isArray(value)) {
        errors.push(`Property "${key}" must be an array (${typeDef}), but received ${getActualType(value)}.`);
      } else {
        if (value.some((item) => item === null || item === undefined)) {
          errors.push(`Property "${key}" array cannot contain null or undefined items.`);
        }
        if (value.some((item) => typeof item === 'string' && item.trim() === '')) {
          errors.push(`Property "${key}" array cannot contain empty string items.`);
        }

        const validItems = value.filter(
          (item) => item !== null && item !== undefined && (typeof item !== 'string' || item.trim() !== '')
        );

        if (!isOptional && validItems.length === 0) {
          errors.push(`Property "${key}" is required and must contain at least one valid non-empty item in the array.`);
        }

        // Element type checks if specified e.g. string[], number[]
        if (lowerTypeDef.startsWith('string[]') || lowerTypeDef.startsWith('array<string>')) {
          if (value.some((item) => item !== null && item !== undefined && typeof item !== 'string')) {
            errors.push(`Property "${key}" array items must all be strings.`);
          }
        } else if (lowerTypeDef.startsWith('number[]') || lowerTypeDef.startsWith('array<number>')) {
          if (value.some((item) => item !== null && item !== undefined && typeof item !== 'number' && isNaN(Number(item)))) {
            errors.push(`Property "${key}" array items must all be numbers.`);
          }
        }
      }
    }
    // 2. STRING CHECK
    else if (lowerTypeDef === 'string' || lowerTypeDef.startsWith('string') || typeDef === '"string"') {
      if (typeof value !== 'string') {
        errors.push(`Property "${key}" must be a string, but received ${getActualType(value)}.`);
      } else if (!isOptional && value.trim() === '') {
        errors.push(`Property "${key}" is required and cannot be an empty string.`);
      }
    }
    // 3. NUMBER CHECK
    else if (lowerTypeDef === 'number' || lowerTypeDef.startsWith('number') || typeDef === '"number"') {
      const isNum = typeof value === 'number' && !isNaN(value);
      const isNumStr = typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value));
      if (!isNum && !isNumStr) {
        errors.push(`Property "${key}" must be a number, but received ${getActualType(value)}.`);
      }
    }
    // 4. BOOLEAN CHECK
    else if (lowerTypeDef === 'boolean' || lowerTypeDef.startsWith('boolean') || typeDef === '"boolean"') {
      const isBool = typeof value === 'boolean' || value === 'true' || value === 'false';
      if (!isBool) {
        errors.push(`Property "${key}" must be a boolean, but received ${getActualType(value)}.`);
      }
    }
    // 5. OBJECT CHECK
    else if (lowerTypeDef === 'object' || lowerTypeDef.startsWith('record<') || typeDef.startsWith('{')) {
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        errors.push(`Property "${key}" must be an object, but received ${getActualType(value)}.`);
      }
    }
    // 6. UNION / LITERAL CHECK e.g. 'SMS' | 'EMAIL' or string | number
    else if (typeDef.includes('|')) {
      const unionParts = typeDef.split('|').map((p) => p.trim().replace(/^['"]|['"]$/g, ''));
      const matchesLiteral = unionParts.includes(String(value));
      const matchesType = unionParts.some((part) => {
        const pLower = part.toLowerCase();
        if (pLower === 'string') return typeof value === 'string';
        if (pLower === 'number') return typeof value === 'number' || !isNaN(Number(value));
        if (pLower === 'boolean') return typeof value === 'boolean' || value === 'true' || value === 'false';
        return false;
      });
      if (!matchesLiteral && !matchesType) {
        errors.push(`Property "${key}" must match union type (${typeDef}), but received ${JSON.stringify(value)}.`);
      }
    }
    // 7. ANY / UNKNOWN
    else if (lowerTypeDef === 'any' || lowerTypeDef === 'unknown') {
      // Valid for any value
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Core Dynamic Mock Server Middleware Handler
app.all('/mock/:envId/*', async (req, res) => {
  const envId = req.params.envId;
  const env = environments.find((e) => e.id === envId || slugify(e.name) === slugify(envId));

  if (!env) {
    return res.status(404).send(`Mock environment with ID or slug "${envId}" not found.`);
  }

  // Extract the actual requested path relative to this mock environment
  // URL is in format: /mock/:envId/path/to/resource
  const rawPath = req.params[0] || '';
  let mockPath = rawPath;

  // If environment has a prefix, strip it cleanly if the path starts with it (segment-by-segment)
  const prefix = env.endpointPrefix ? env.endpointPrefix.replace(/^\/+|\/+$/g, '').trim() : '';
  if (prefix) {
    const cleanMockPath = mockPath.replace(/^\/+|\/+$/g, '');
    const prefixSegments = prefix.split('/');
    const pathSegments = cleanMockPath.split('/');
    
    let matchesPrefix = true;
    for (let i = 0; i < prefixSegments.length; i++) {
      if (pathSegments[i] !== prefixSegments[i]) {
        matchesPrefix = false;
        break;
      }
    }
    
    if (matchesPrefix) {
      mockPath = pathSegments.slice(prefixSegments.length).join('/');
    }
  }

  const incomingMethod = req.method.toLowerCase() as HttpMethod;

  // Handle CORS preflight (OPTIONS) requests automatically for any path in this environment
  if (incomingMethod === 'options') {
    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Origin, Accept, Authorization, Content-Length, X-Requested-With, x-auth-token, x-request-channel, x-browser, x-device-os, x-fingerprint, x-device-type, x-device-id, x-session-id, x-screen-name, x-request-id, x-country, x-origin, x-service-name, xp-service-code, xp-service-request-id, xp-token',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true'
    };

    if (env.headers) {
      env.headers.forEach((h) => {
        if (h.key && h.value) {
          responseHeaders[h.key] = parseTemplate(h.value, { query: {}, body: {}, headers: {}, params: {} });
        }
      });
    }

    Object.keys(responseHeaders).forEach((key) => {
      res.setHeader(key, responseHeaders[key]);
    });

    return res.status(204).end();
  }

  // Find a matching route
  let matchedRoute = null;
  let capturedParams: Record<string, string> = {};
  let methodFallbackWarning: string | undefined = undefined;

  for (const r of env.routes) {
    const routeMethod = String(r.method || 'get').toLowerCase();
    if (routeMethod === incomingMethod) {
      const matchResult = matchPath(r.endpoint, mockPath);
      if (matchResult.matches) {
        matchedRoute = r;
        capturedParams = matchResult.params;
        break;
      }
    }
  }

  if (!matchedRoute) {
    // Check if there is an alternative route matching the endpoint but with a different HTTP method
    let alternativeRoute = null;
    let alternativeParams: Record<string, string> = {};
    for (const r of env.routes) {
      const matchResult = matchPath(r.endpoint, mockPath);
      if (matchResult.matches) {
        alternativeRoute = r;
        alternativeParams = matchResult.params;
        break;
      }
    }

    if (alternativeRoute) {
      const altMethod = alternativeRoute.method.toUpperCase();
      const requestedMethod = req.method.toUpperCase();
      const errorMsg = `Method Mismatch: You requested ${requestedMethod} but this endpoint is configured for ${altMethod}.`;
      
      const errorBody = {
        success: false,
        message: errorMsg,
        data: {
          responseCode: "METHOD_MISMATCH",
          configuredMethod: altMethod,
          requestedMethod: requestedMethod
        }
      };

      const logId = 'log-' + Math.random().toString(36).substr(2, 9);
      const logItem: RequestLog = {
        id: logId,
        timestamp: new Date().toISOString(),
        envId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip || '127.0.0.1',
        headers: req.headers as Record<string, string>,
        queryParams: req.query as Record<string, string>,
        body: req.body,
        responseStatus: 405,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: JSON.stringify(errorBody, null, 2),
        matchedRoute: `${altMethod} /${alternativeRoute.endpoint} (Method Mismatch)`,
        latency: 0,
        warning: `Method Mismatch: Expected ${altMethod}`
      };
      requestLogs.unshift(logItem);
      if (requestLogs.length > MAX_LOGS) requestLogs.pop();

      return res.status(405).json(errorBody);
    } else {
      let errorMsg = `Mock route [${req.method.toUpperCase()} /${mockPath}] not found in environment "${env.name}".`;
      
      // If no route matched, log the unmapped request
      const logId = 'log-' + Math.random().toString(36).substr(2, 9);
      const latencyVal = 0;
      const logItem: RequestLog = {
        id: logId,
        timestamp: new Date().toISOString(),
        envId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip || '127.0.0.1',
        headers: req.headers as Record<string, string>,
        queryParams: req.query as Record<string, string>,
        body: req.body,
        responseStatus: 404,
        responseHeaders: { 'Content-Type': 'text/plain' },
        responseBody: errorMsg,
        matchedRoute: 'None (No matching endpoints)',
        latency: latencyVal,
      };
      requestLogs.unshift(logItem);
      if (requestLogs.length > MAX_LOGS) requestLogs.pop();

      return res.status(404).send(errorMsg);
    }
  }

  // Prepare details for rule matching and template rendering
  const requestDetails = {
    query: req.query,
    body: req.body,
    headers: req.headers,
    params: capturedParams,
  };

  // Find matching response based on rules
  let matchedResponse = null;

  // Search through response rules in order
  for (const resp of matchedRoute.responses) {
    if (resp.rules && resp.rules.length > 0) {
      const rulesMatched = evaluateRules(resp.rules, resp.rulesOperator, requestDetails);
      if (rulesMatched) {
        matchedResponse = resp;
        break;
      }
    }
  }

  // Fallback to selected default response if no rules matched
  if (!matchedResponse) {
    matchedResponse = matchedRoute.responses.find((r) => r.id === matchedRoute.selectedResponseId) || matchedRoute.responses[0];
  }

  // Perform schema validation if a validation interface is defined and it is not a GET request.
  const validationSchema = (matchedResponse && matchedResponse.validationInterface && matchedResponse.validationInterface.trim() !== '')
    ? matchedResponse.validationInterface
    : (matchedRoute.responses.find((r) => r.id === matchedRoute.selectedResponseId)?.validationInterface ||
       matchedRoute.responses.find((r) => r.validationInterface && r.validationInterface.trim() !== '')?.validationInterface);

  const isValidationRequired = req.method !== 'GET' && !!validationSchema && validationSchema.trim() !== '';

  if (isValidationRequired && validationSchema) {
    const validation = validateBodyAgainstTSInterface(req.body, validationSchema);
    if (!validation.valid) {
      const logId = 'log-' + Math.random().toString(36).substr(2, 9);
      const logItem: RequestLog = {
        id: logId,
        timestamp: new Date().toISOString(),
        envId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip || '127.0.0.1',
        headers: req.headers as Record<string, string>,
        queryParams: req.query as Record<string, string>,
        body: req.body,
        responseStatus: 400,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: JSON.stringify({
          success: false,
          message: "Payload validation failed: request body does not match the required interface/schema contract.",
          errors: validation.errors
        }, null, 2),
        matchedRoute: `${matchedRoute.method.toUpperCase()} /${matchedRoute.endpoint}`,
        latency: 0,
      };
      requestLogs.unshift(logItem);
      if (requestLogs.length > MAX_LOGS) requestLogs.pop();

      return res.status(400).json({
        success: false,
        message: "Payload validation failed: request body does not match the required interface/schema contract.",
        errors: validation.errors
      });
    }
  }

  // Calculate delay (latency)
  // Priorities: Route latency override -> Global environment fallback -> 0
  const delay = matchedRoute.latency !== undefined && matchedRoute.latency !== null && matchedRoute.latency >= 0
    ? matchedRoute.latency
    : (env.latency || 0);

  // Parse headers and response body
  const responseHeaders: Record<string, string> = {};

  // Apply environment-level global headers
  if (env.headers) {
    env.headers.forEach((h) => {
      if (h.key && h.value) {
        responseHeaders[h.key] = parseTemplate(h.value, requestDetails);
      }
    });
  }

  // Apply route-response specific headers (overriding globals if match)
  if (matchedResponse.headers) {
    matchedResponse.headers.forEach((h) => {
      if (h.key && h.value) {
        responseHeaders[h.key] = parseTemplate(h.value, requestDetails);
      }
    });
  }

  // Inject warning headers if we fell back on method mismatch
  if (methodFallbackWarning) {
    responseHeaders['X-Mock-Method-Fallback'] = 'true';
    responseHeaders['X-Mock-Warning'] = methodFallbackWarning;
  }

  const rawBody = matchedResponse.body || '';
  const parsedBody = parseTemplate(rawBody, requestDetails);

  // Validate if response body is valid JSON when Content-Type is application/json
  let responseWarning: string | undefined = undefined;
  const isJsonHeader = Object.entries(responseHeaders).some(
    ([k, v]) => k.toLowerCase() === 'content-type' && String(v).toLowerCase().includes('application/json')
  );
  if (isJsonHeader && parsedBody && parsedBody.trim()) {
    try {
      JSON.parse(parsedBody);
    } catch (err: any) {
      responseWarning = `Content-Type is set to 'application/json' but the response body is not valid JSON! This will cause client-side applications (like Axios, Fetch, or your bank front-end app) to crash or return empty objects when parsing. Parsing error: ${err.message}. Raw body was: "${parsedBody}"`;
      console.warn(`[Mock Warning] Route [${matchedRoute.method.toUpperCase()} /${matchedRoute.endpoint}] returned invalid JSON:`, parsedBody);
    }
  }

  // Set status code
  const statusCode = matchedResponse.statusCode || 200;

  // Apply latency delay
  setTimeout(() => {
    // Send headers
    Object.keys(responseHeaders).forEach((key) => {
      res.setHeader(key, responseHeaders[key]);
    });

    // Create execution log
    const logId = 'log-' + Math.random().toString(36).substr(2, 9);
    const combinedWarning = [methodFallbackWarning, responseWarning].filter(Boolean).join(' | ');
    const logItem: RequestLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      envId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || '127.0.0.1',
      headers: req.headers as Record<string, string>,
      queryParams: req.query as Record<string, string>,
      body: req.body,
      responseStatus: statusCode,
      responseHeaders,
      responseBody: parsedBody,
      matchedRoute: `${matchedRoute.method.toUpperCase()} /${matchedRoute.endpoint}`,
      latency: delay,
      warning: combinedWarning || undefined
    };

    requestLogs.unshift(logItem);
    if (requestLogs.length > MAX_LOGS) requestLogs.pop();

    res.status(statusCode).send(parsedBody);
  }, delay);
});

// Vite Middleware for Asset Handling and Dev Server routing
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API Mock Server running on port ${PORT}`);
  });
}

startServer();
