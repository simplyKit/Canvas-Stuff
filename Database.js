
require('dotenv').config();

let fetch;
try {
  const nf = require('node-fetch');
  fetch = nf.default || nf;
} catch (e) {
  if (typeof global.fetch === 'function') fetch = global.fetch;
  else throw e;
}

// Cloudflare Workers KV API details
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_KEY;
const CF_NAMESPACE_ID = process.env.CLOUDFLARE_NAMESPACE_ID;

// ============ HELPERS ============
function parseKeyPath(key) {
  if (!key) return [];
  if (Array.isArray(key)) return key;
  // Support both dot and slash notation for nested keys
  return key.split(/[./]/).filter(Boolean);
}

function getNested(obj, keyPathArr) {
  if (!obj) return undefined;
  return keyPathArr.reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function setNested(obj, keyPathArr, value) {
  let current = obj;
  for (let i = 0; i < keyPathArr.length - 1; i++) {
    const key = keyPathArr[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keyPathArr[keyPathArr.length - 1]] = value;
  return obj;
}

function deleteNested(obj, keyPathArr) {
    if (!keyPathArr || keyPathArr.length === 0) return; // Cannot delete root
    let current = obj;
    for (let i = 0; i < keyPathArr.length - 1; i++) {
        const key = keyPathArr[i];
        if (!current[key] || typeof current[key] !== 'object') {
            // Path doesn't exist, nothing to delete
            return;
        }
        current = current[key];
    }
    delete current[keyPathArr[keyPathArr.length - 1]];
}


// ============ WORKERS KV HELPERS ============
async function kvFetch(method, key, body) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_NAMESPACE_ID) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_KEY, and CLOUDFLARE_NAMESPACE_ID must be set in .env");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  if (method === 'GET' && res.status === 404) return null; // Key not found

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`KV Error Response: ${errorText}`);
    throw new Error(`Failed KV operation (${method}) on key "${key}": ${res.status} ${res.statusText}`);
  }

  if (method === 'GET') {
      const text = await res.text();
      try {
          return JSON.parse(text); // Try parsing as JSON
      } catch (e) {
          return text; // Return as plain text if not JSON
      }
  }

  return true; // For PUT/DELETE success
}

// ============ CORE FUNCTIONS ============

/**
 * Gets a value from the KV store. Supports nested keys.
 * @param {string} key - The top-level key.
 * @param {string} [nestedKey] - The nested key (e.g., 'path.to.value' or 'path/to/value').
 * @returns {Promise<any>} The value, or undefined if not found.
 */
async function getData(key, nestedKey) {
  const data = await kvFetch('GET', key);
  if (data === null) return undefined; // Use undefined for not found consistently
  if (!nestedKey) return data; // Return whole object if no nested key

  const keyPathArr = parseKeyPath(nestedKey);
  return getNested(data, keyPathArr);
}

/**
 * Sets a value in the KV store. Supports nested keys.
 * If a nested key is provided, it will set the value at that path within the top-level key's object.
 * If the nested path doesn't exist, it will be created.
 * @param {string} key - The top-level key.
 * @param {string|any} nestedKeyOrValue - The nested key or the value to set if no value is provided.
 * @param {any} [value] - The value to set.
 * @returns {Promise<boolean>}
 */
async function setData(key, nestedKeyOrValue, value) {
    let nestedKey, finalValue;
    if (value === undefined) {
        // Called as setData(key, value)
        nestedKey = null;
        finalValue = nestedKeyOrValue;
    } else {
        // Called as setData(key, nestedKey, value)
        nestedKey = nestedKeyOrValue;
        finalValue = value;
    }

    if (!nestedKey) {
        // Overwrite the whole value for the top-level key
        return await kvFetch('PUT', key, finalValue);
    }

    // Handle nested update
    let data = await kvFetch('GET', key);
    if (data === null || typeof data !== 'object') {
        data = {}; // If key doesn't exist or is not an object, start with a new object
    }
    const keyPathArr = parseKeyPath(nestedKey);
    const updatedData = setNested(data, keyPathArr, finalValue);

    return await kvFetch('PUT', key, updatedData);
}

/**
 * Deletes a key or a nested property from the KV store.
 * @param {string} key - The top-level key.
 * @param {string} [nestedKey] - The nested key to delete (e.g., 'path.to.value'). If not provided, the entire top-level key is deleted.
 * @returns {Promise<boolean>}
 */
async function delData(key, nestedKey) {
  if (!nestedKey) {
    return await kvFetch('DELETE', key);
  }

  // Handle nested delete
  let data = await kvFetch('GET', key);
  if (data === null || typeof data !== 'object') {
    return true; // Nothing to delete
  }

  const keyPathArr = parseKeyPath(nestedKey);
  deleteNested(data, keyPathArr);

  return await kvFetch('PUT', key, data);
}

/**
 * Appends a value to an array in the KV store.
 * Assumes the top-level key holds an array.
 * If the key does not exist or is not an array, it will be created as a new array with the value.
 * @param {string} key - The top-level key whose value is an array.
 * @param {any} value - The value to append to the array.
 * @returns {Promise<boolean>}
 */
async function addData(key, value) {
  let existingData = await kvFetch('GET', key);

  if (existingData === null || !Array.isArray(existingData)) {
    existingData = [];
  }

  existingData.push(value);

  return await kvFetch('PUT', key, existingData);
}

module.exports = {
  getData,
  setData,
  delData,
  addData
};
