// Based on `Module._load()`.
// Copyright Node.js contributors. Released under MIT license:
// https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js

import ENTRY from "../../constant/entry.js"
import PACKAGE from "../../constant/package.js"

import Entry from "../../entry.js"
import Module from "../../module.js"

import _load from "../internal/load.js"
import errors from "../../errors.js"
import esmLoad from "../esm/load.js"
import esmState from "../esm/state.js"
import loader from "../cjs/loader.js"
import protoLoad from "../proto/load.js"
import shared from "../../shared.js"

const {
  TYPE_CJS,
  TYPE_ESM
} = ENTRY

const {
  OPTIONS_MODE_STRICT
} = PACKAGE

const {
  ERR_REQUIRE_ESM
} = errors

function load(request, parent, isMain) {
  const { parsing } = shared.moduleState
  const parentEntry = parent && Entry.get(parent)

  if (parentEntry &&
      parentEntry._require === TYPE_ESM) {
    parentEntry._require = TYPE_CJS
    return esmLoad(request, parent, isMain).module.exports
  }

  const filename = Module._resolveFilename(request, parent, isMain)
  const { scratchCache } = esmState

  let cache = Module._cache

  if (parsing) {
    cache = scratchCache
  } else if (Reflect.has(scratchCache, filename)) {
    cache[filename] = scratchCache[filename]
    Reflect.deleteProperty(scratchCache, filename)
  }

  let loaderCalled = false

  const entry = _load(filename, parent, isMain, cache, (entry) => {
    loaderCalled = true
    cache[filename] = entry.module
    tryLoader(entry, cache, filename, filename, parentEntry)
  })

  if (! loaderCalled &&
      parentEntry &&
      entry.type === TYPE_ESM &&
      parentEntry.package.options.mode === OPTIONS_MODE_STRICT) {
    throw new ERR_REQUIRE_ESM(filename)
  }

  return entry.module.exports
}

function tryLoader(entry, cache, cacheKey, filename, parentEntry) {
  const mod = entry.module

  let threw = true

  try {
    if (mod.load === protoLoad) {
      loader(entry, filename, parentEntry)
    } else {
      mod.load(filename)
    }

    threw = false
  } finally {
    if (threw) {
      Reflect.deleteProperty(cache, cacheKey)
    }
  }
}

export default load
