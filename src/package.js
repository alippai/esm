import { basename, dirname, resolve, sep } from "./safe/path.js"

import CHAR_CODE from "./constant/char-code.js"
import ENV from "./constant/env.js"
import ESM from "./constant/esm.js"
import PACKAGE from "./constant/package.js"

import GenericBuffer from "./generic/buffer.js"

import assign from "./util/assign.js"
import builtinLookup from "./builtin-lookup.js"
import { cwd } from "./safe/process.js"
import defaults from "./util/defaults.js"
import errors from "./errors.js"
import esmParseLoad from "./module/esm/parse-load.js"
import getModuleDirname from "./util/get-module-dirname.js"
import has from "./util/has.js"
import isCacheName from "./util/is-cache-name.js"
import isFile from "./util/is-file.js"
import isJSON from "./path/is-json.js"
import isObject from "./util/is-object.js"
import isObjectLike from "./util/is-object-like.js"
import keys from "./util/keys.js"
import parseJSON from "./util/parse-json.js"
import parseJSON6 from "./util/parse-json6.js"
import readFile from "./fs/read-file.js"
import readJSON from "./fs/read-json.js"
import readJSON6 from "./fs/read-json6.js"
import readdir from "./fs/readdir.js"
import removeFile from "./fs/remove-file.js"
import shared from "./shared.js"
import stripPrereleaseTag from "./util/strip-prerelease-tag.js"
import toStringLiteral from "./util/to-string-literal.js"
import { validRange } from "semver"

const {
  DOT
} = CHAR_CODE

const {
  OPTIONS
} = ENV

const {
  PKG_VERSION
} = ESM

const {
  OPTIONS_MODE_ALL,
  OPTIONS_MODE_AUTO,
  OPTIONS_MODE_STRICT,
  RANGE_ALL
} = PACKAGE

const {
  ERR_INVALID_ESM_OPTION,
  ERR_UNKNOWN_ESM_OPTION
} = errors

const ESMRC_FILENAME = ".esmrc"
const PACKAGE_FILENAME = "package.json"

const defaultOptions = {
  await: false,
  cache: true,
  cjs: {
    cache: false,
    extensions: false,
    interop: false,
    mutableNamespace: false,
    namedExports: false,
    paths: false,
    topLevelReturn: false,
    vars: false
  },
  debug: false,
  force: false,
  mainFields: ["main"],
  mode: "strict",
  sourceMap: void 0
}

const autoOptions = {
  cjs: {
    cache: true,
    extensions: true,
    interop: true,
    mutableNamespace: true,
    namedExports: true,
    paths: true,
    topLevelReturn: false,
    vars: true
  },
  mode: "auto"
}

class Package {
  static createOptions = createOptions
  static defaultOptions = defaultOptions
  static state = null

  constructor(dirPath, range, options) {
    options = Package.createOptions(options)

    let cachePath

    if (typeof options.cache === "string") {
      cachePath = resolve(dirPath, options.cache)
    } else if (options.cache !== false) {
      cachePath = dirPath + sep + "node_modules" + sep + ".cache" + sep + "esm"
    } else {
      cachePath = ""
    }

    const { dir } = shared.package

    let cache = dir[cachePath]

    if (! cache) {
      cache =
      dir[cachePath] = {
        buffer: null,
        compile: null,
        map: null
      }

      let buffer
      let map
      let compileDatas = { __proto__: null }

      if (cachePath) {
        const cacheNames = readdir(cachePath)

        let hasBuffer = false
        let hasDirtyMarker = false
        let hasMap = false

        for (const cacheName of cacheNames) {
          if (isCacheName(cacheName)) {
            // Later, we'll change the cached value to its associated compiler result,
            // but for now we merely register that a cache file exists.
            compileDatas[cacheName] = null
          } else if (cacheName.charCodeAt(0) === DOT) {
            if (cacheName === ".data.blob") {
              hasBuffer = true
            } else if (cacheName === ".data.json") {
              hasMap = true
            } else if (cacheName === ".dirty") {
              hasDirtyMarker = true
              break
            }
          }
        }

        let json
        let isCacheInvalid = hasDirtyMarker

        if (hasMap &&
            ! isCacheInvalid) {
          json = readJSON(cachePath + sep + ".data.json")

          isCacheInvalid =
            ! json ||
            ! has(json, "version") ||
            json.version !== PKG_VERSION ||
            ! has(json, "map") ||
            ! isObject(json.map)
        }

        if (isCacheInvalid) {
          hasBuffer =
          hasMap = false

          compileDatas = { __proto__: null }

          if (hasDirtyMarker) {
            removeFile(cachePath + sep + ".dirty")
          }

          clearBabelCache(cachePath)
        }

        if (hasBuffer) {
          buffer = readFile(cachePath + sep + ".data.blob")
        }

        if (hasMap) {
          map = json.map
          Reflect.setPrototypeOf(map, null)
        }
      }

      cache.buffer = buffer || GenericBuffer.alloc(0)
      cache.compile = compileDatas
      cache.map = map || { __proto__: null }
    }

    this.cache = cache
    this.cachePath = cachePath
    this.dirPath = dirPath
    this.options = options
    this.range = range
  }

  clone()  {
    const cloned = assign({ __proto__: Package.prototype }, this)

    cloned.options = assign({}, cloned.options)
    return cloned
  }

  static get(dirPath, forceOptions) {
    if (dirPath === ".") {
      dirPath = cwd()
    }

    return getInfo(dirPath, forceOptions) || Package.state.default
  }

  static from(request, forceOptions) {
    let dirPath = "."

    if (typeof request === "string") {
      dirPath = Reflect.has(builtinLookup, request) ? "" : dirname(request)
    } else {
      dirPath = getModuleDirname(request)
    }

    return Package.get(dirPath, forceOptions)
  }

  static set(dirPath, pkg) {
    Package.state.cache[dirPath] = pkg || null
  }
}

function clearBabelCache(cachePath) {
  const babelCachePath = resolve(cachePath, "../@babel/register")
  const cacheNames = readdir(babelCachePath)

  for (const cacheName of cacheNames) {
    if (isJSON(cacheName)) {
      removeFile(babelCachePath + sep + cacheName)
    }
  }
}

function createCJS(value) {
  const defaultCJS = Package.defaultOptions.cjs
  const options = {}

  if (value === void 0) {
    return assign(options, defaultCJS)
  }

  if (isObjectLike(value)) {
    const possibleNames = keys(value)

    for (const name of possibleNames) {
      if (Reflect.has(defaultCJS, name)) {
        const optionsValue = value[name]

        if (isFlag(optionsValue)) {
          options[name] = !! optionsValue
        } else {
          throw new ERR_INVALID_ESM_OPTION(
            "cjs[" + toStringLiteral(name, "'") + "]",
            optionsValue,
            true
          )
        }
      } else {
        throw new ERR_UNKNOWN_ESM_OPTION("cjs[" + toStringLiteral(name, "'") + "]")
      }
    }

    return defaults(options, defaultCJS)
  }

  const names = keys(defaultCJS)
  const optionsValue = !! value

  for (const name of names) {
    options[name] = optionsValue
  }

  return options
}

function createOptions(value) {
  const { defaultOptions } = Package
  const names = []

  let options = {}

  if (typeof value === "string") {
    names.push("mode")
    options.mode = value
  } else {
    const possibleNames = keys(value)

    for (const name of possibleNames) {
      if (Reflect.has(defaultOptions, name)) {
        names.push(name)
        options[name] = value[name]
      } else if (name === "sourcemap" &&
          possibleNames.indexOf("sourceMap") === -1) {
        options.sourceMap = value.sourcemap
      } else {
        throw new ERR_UNKNOWN_ESM_OPTION(name)
      }
    }
  }

  if (names.indexOf("cjs") === -1) {
    options.cjs = autoOptions.cjs
  }

  if (names.indexOf("mode") === -1) {
    options.mode = autoOptions.mode
  }

  const cjsOptions = createCJS(options.cjs)

  defaults(options, defaultOptions)
  options.cjs = cjsOptions

  const awaitOption = options.await

  if (isFlag(awaitOption)) {
    options.await = !! awaitOption
  } else {
    throw new ERR_INVALID_ESM_OPTION("await", awaitOption)
  }

  const { cache } = options

  if (isFlag(cache)) {
    options.cache = !! cache
  } else if (typeof cache !== "string") {
    throw new ERR_INVALID_ESM_OPTION("cache", cache)
  }

  const { debug } = options

  if (isFlag(debug)) {
    options.debug = !! debug
  } else {
    throw new ERR_INVALID_ESM_OPTION("debug", debug)
  }

  const { force } = options

  if (isFlag(force)) {
    options.force = !! force
  } else {
    throw new ERR_INVALID_ESM_OPTION("force", cache)
  }

  const defaultMainFields = defaultOptions.mainFields

  let { mainFields } = options

  if (! Array.isArray(mainFields)) {
    mainFields = [mainFields]
  }

  if (mainFields === defaultMainFields) {
    mainFields = [defaultMainFields[0]]
  } else {
    mainFields = Array.from(mainFields, (field) => {
      if (typeof field !== "string") {
        throw new ERR_INVALID_ESM_OPTION("mainFields", mainFields)
      }

      return field
    })
  }

  if (mainFields.indexOf("main") === -1) {
    mainFields.push("main")
  }

  options.mainFields = mainFields

  const { mode } = options

  if (mode === OPTIONS_MODE_ALL ||
      mode === "all") {
    options.mode = OPTIONS_MODE_ALL
  } else if (mode === OPTIONS_MODE_AUTO ||
      mode === "auto") {
    options.mode = OPTIONS_MODE_AUTO
  } else if (mode === OPTIONS_MODE_STRICT ||
      mode === "strict") {
    options.mode = OPTIONS_MODE_STRICT
  } else {
    throw new ERR_INVALID_ESM_OPTION("mode", mode)
  }

  const { sourceMap } = options

  if (isFlag(sourceMap)) {
    options.sourceMap = !! sourceMap
  } else if (sourceMap !== void 0) {
    throw new ERR_INVALID_ESM_OPTION("sourceMap", sourceMap)
  }

  return options
}

function findRoot(dirPath) {
  if (basename(dirPath) === "node_modules" ||
      isFile(dirPath + sep + PACKAGE_FILENAME)) {
    return dirPath
  }

  const parentPath = dirname(dirPath)

  if (parentPath === dirPath) {
    return ""
  }

  return basename(parentPath) === "node_modules"
    ? dirPath
    : findRoot(parentPath)
}

function getInfo(dirPath, forceOptions) {
  const defaultPkg = Package.state.default

  let pkg = null

  if (Reflect.has(Package.state.cache, dirPath)) {
    pkg = Package.state.cache[dirPath]

    if (! forceOptions ||
        pkg) {
      return pkg
    }
  }

  if (basename(dirPath) === "node_modules") {
    return Package.state.cache[dirPath] = null
  }

  if (defaultPkg &&
      defaultPkg.options.force === true) {
    // Clone the default package to avoid the parsing phase fallback path
    // of module/internal/compile.
    pkg = defaultPkg.clone()
  } else {
    pkg = readInfo(dirPath, forceOptions)
  }

  if (pkg === null) {
    const parentPath = dirname(dirPath)

    if (parentPath !== dirPath) {
      pkg = getInfo(parentPath)
    }
  }

  return Package.state.cache[dirPath] = pkg
}

function getRange(json, name) {
  if (has(json, name)) {
    const object = json[name]

    if (has(object, "esm")) {
      return validRange(object["esm"])
    }
  }

  return null
}

function getRoot(dirPath) {
  const { root } = shared.package
  const cached = root[dirPath]

  if (cached) {
    return cached
  }

  return root[dirPath] = findRoot(dirPath) || dirPath
}

function isFlag(value) {
  return typeof value === "boolean" ||
    value === 0 ||
    value === 1
}

function readInfo(dirPath, forceOptions) {
  let pkg
  let optionsPath = dirPath + sep + ESMRC_FILENAME

  let options = isFile(optionsPath)
    ? readFile(optionsPath, "utf8")
    : null

  let optionsFound = options !== null

  if (optionsFound) {
    options = parseJSON6(options)
  } else if (isFile(optionsPath + ".mjs")) {
    optionsPath = optionsPath + ".mjs"
  } else if (isFile(optionsPath + ".js")) {
    optionsPath = optionsPath + ".js"
  } else if (isFile(optionsPath + ".json")) {
    optionsPath = optionsPath + ".json"
  } else {
    optionsPath = ""
  }

  if (! optionsFound &&
      optionsPath) {
    optionsFound = true

    if (isJSON(optionsPath)) {
      options = readJSON6(optionsPath)
    } else {
      const { moduleState } = shared
      const { parsing } = moduleState
      const { cache } = Package.createOptions(forceOptions)

      moduleState.parsing = false

      pkg =
      Package.state.cache[dirPath] = new Package(dirPath, RANGE_ALL, { cache })

      try {
        pkg.options =
        Package.createOptions(esmParseLoad(optionsPath, null, false).module.exports)
      } finally {
        moduleState.parsing = parsing
        Package.state.cache[dirPath] = null
      }
    }
  }

  const pkgPath = dirPath + sep + PACKAGE_FILENAME

  let pkgJSON = isFile(pkgPath)
    ? readFile(pkgPath, "utf8")
    : null

  let parentPkg

  if (! forceOptions &&
      pkgJSON === null) {
    if (optionsFound) {
      parentPkg = getInfo(dirname(dirPath))
    } else {
      return null
    }
  }

  let pkgParsed = false

  if (! optionsFound &&
      pkgJSON !== null) {
    pkgParsed = true
    pkgJSON = parseJSON(pkgJSON)

    if (has(pkgJSON, "esm")) {
      optionsFound = true
      options = pkgJSON["esm"]
    }
  }

  let range

  if (forceOptions) {
    range = RANGE_ALL
  } else if (parentPkg) {
    range = parentPkg.range
  } else {
    if (! pkgParsed &&
        pkgJSON !== null) {
      pkgParsed = true
      pkgJSON = parseJSON(pkgJSON)
    }

    // A package.json may have `esm` in its "devDependencies" object because
    // it expects another package or application to enable ESM loading in
    // production, but needs `esm` during development.
    range =
      getRange(pkgJSON, "dependencies") ||
      getRange(pkgJSON, "peerDependencies")

    if (range === null) {
      if (optionsFound ||
          getRange(pkgJSON, "devDependencies")) {
        range = RANGE_ALL
      } else {
        return null
      }
    }
  }

  if (pkg) {
    pkg.range = range
    return pkg
  }

  if (forceOptions &&
      ! optionsFound) {
    optionsFound = true
    options = forceOptions
  }

  if (options === true ||
      ! optionsFound) {
    options = OPTIONS
  }

  if (! pkgParsed &&
      pkgJSON === null) {
    dirPath = getRoot(dirPath)
  }

  return new Package(dirPath, range, options)
}

Reflect.setPrototypeOf(Package.prototype, null)

const cacheKey = JSON.stringify(Package.createOptions())
const { state } = shared.package

Package.state = state[cacheKey] || (state[cacheKey] = {
  cache: { __proto__: null },
  default: null
})

Package.state.cache[""] = new Package("", stripPrereleaseTag(PKG_VERSION), {
  cache: false,
  cjs: true
})

export default Package
