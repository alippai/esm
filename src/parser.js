import { Parser as AcornParser } from "acorn/dist/acorn.es.js"

import createOptions from "./util/create-options.js"
import { enable as enableAwaitAnywhere } from "./acorn-ext/await-anywhere.js"
import { enable as enableDynamicImport } from "./acorn-ext/dynamic-import.js"
import { enable as enableExport } from "./acorn-ext/export.js"
import { enable as enableImport } from "./acorn-ext/import.js"
import { enable as enableTolerance } from "./acorn-ext/tolerance.js"

const acornParser = new AcornParser
const acornRaise = acornParser.raise

const defaultOptions = {
  allowReturnOutsideFunction: false,
  ecmaVersion: 9,
  enableExportExtensions: false,
  enableImportExtensions: false,
  sourceType: "module"
}

class Parser {
  static getNamesFromPattern(pattern) {
    let i = -1
    const names = []
    const queue = [pattern]

    while (++i < queue.length) {
      const pattern = queue[i]
      if (pattern === null) {
        // The ArrayPattern .elements array can contain null to indicate that
        // the position is a hole.
        continue
      }

      // Cases are ordered from most to least likely to encounter.
      switch (pattern.type) {
      case "Identifier":
        names.push(pattern.name)
        break
      case "Property":
      case "ObjectProperty":
        queue.push(pattern.value)
        break
      case "AssignmentPattern":
        queue.push(pattern.left)
        break
      case "ObjectPattern":
        queue.push.apply(queue, pattern.properties)
        break
      case "ArrayPattern":
        queue.push.apply(queue, pattern.elements)
        break
      case "RestElement":
        queue.push(pattern.argument)
        break
      }
    }

    return names
  }

  static lookahead(parser) {
    acornParser.input = parser.input
    acornParser.pos = parser.pos
    acornParser.nextToken()
    return acornParser
  }

  static parse(code, options) {
    options = createOptions(options, defaultOptions)
    return extend(new AcornParser(options, code), options).parse()
  }

  static raise(parser) {
    acornRaise.call(parser, parser.start, "Unexpected token")
  }
}

function extend(parser, options) {
  enableAwaitAnywhere(parser)
  enableDynamicImport(parser)
  enableTolerance(parser)

  if (options.enableExportExtensions) {
    enableExport(parser)
  }

  if (options.enableImportExtensions) {
    enableImport(parser)
  }

  return parser
}

Object.setPrototypeOf(Parser.prototype, null)

export default Parser
