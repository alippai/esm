// Parser support for dynamic import and import meta property syntax.
// https://github.com/tc39/proposal-dynamic-import
// https://github.com/tc39/proposal-import-meta
//
// Dynamic import syntax is based on acorn-dynamic-import.
// Copyright Jordan Gensler. Released under MIT license:
// https://github.com/kesne/acorn-dynamic-import
//
// Import meta property syntax is adapted from babel-parser.
// Copyright Sebastian McKenzie and other contributors. Released under MIT license:
// https://github.com/babel/babel/blob/master/packages/babel-parser/src/parser/expression.js

import PARSER_MESSAGE from "../../constant/parser-message.js"

import errors from "../../parse/errors.js"
import lookahead from "../../parse/lookahead.js"
import shared from "../../shared.js"
import { tokTypes as tt } from "../../acorn.js"
import wrap from "../../util/wrap.js"

function init() {
  const {
    ILLEGAL_IMPORT_META_OUTSIDE_MODULE,
    INVALID_LEFT_HAND_SIDE_ASSIGNMENT,
    UNEXPECTED_IDENTIFIER,
    UNEXPECTED_STRING,
    UNEXPECTED_TOKEN
  } = PARSER_MESSAGE

  const Plugin = {
    enable(parser) {
      // Allow `yield import()` to parse.
      tt._import.startsExpr = true

      parser.checkLVal = wrap(parser.checkLVal, checkLVal)
      parser.parseExport = wrap(parser.parseExport, parseExport)
      parser.parseExprAtom = wrap(parser.parseExprAtom, parseExprAtom)
      parser.parseNew = wrap(parser.parseNew, parseNew)
      parser.parseStatement = wrap(parser.parseStatement, parseStatement)
      parser.parseSubscripts = wrap(parser.parseSubscripts, parseSubscripts)
      return parser
    }
  }

  function checkLVal(func, args) {
    const [expr] = args

    if (expr.type === "CallExpression" &&
        expr.callee.type === "Import") {
      throw new errors.ReferenceError(this.input, expr.start, INVALID_LEFT_HAND_SIDE_ASSIGNMENT)
    }

    return Reflect.apply(func, this, args)
  }

  function parseExport(func, args) {
    const { type } = lookahead(this)

    if (type !== tt.star) {
      return Reflect.apply(func, this, args)
    }

    const [node, exported] = args

    this.next()

    const { start, startLoc } = this

    this.next()

    let finishType = "ExportAllDeclaration"

    if (this.eatContextual("as")) {
      const identifier = this.parseIdent(true)

      this.checkExport(exported, identifier.name, identifier.start)

      const specifier = this.startNodeAt(start, startLoc)

      finishType = "ExportNamedDeclaration"
      specifier.exported = identifier
      node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")]
    }

    this.expectContextual("from")

    if (this.type !== tt.string) {
      this.unexpected()
    }

    node.source = this.parseExprAtom()
    this.semicolon()
    return this.finishNode(node, finishType)
  }

  function parseExprAtom(func, args) {
    if (this.type === tt._import) {
      const { type } = lookahead(this)

      if (type === tt.dot) {
        return parseImportMetaPropertyAtom(this)
      }

      if (type === tt.parenL) {
        return parseImportCallAtom(this)
      }

      this.unexpected()
    }

    const node = Reflect.apply(func, this, args)
    const { type } = node

    if (type === tt._false ||
        type === tt._null ||
        type === tt._true) {
      node.raw = ""
    }

    return node
  }

  function parseNew(func, args) {
    const { type } = lookahead(this)

    if (type === tt._import) {
      this.unexpected()
    }

    return Reflect.apply(func, this, args)
  }

  function parseSubscripts(func, args) {
    const [base, startPos, startLoc] = args

    if (base.type === "Import" &&
        this.type === tt.parenL) {
      const callExpr = this.startNodeAt(startPos, startLoc)

      this.expect(tt.parenL)

      callExpr.arguments = [this.parseMaybeAssign()]
      callExpr.callee = base

      this.expect(tt.parenR)
      this.finishNode(callExpr, "CallExpression")

      args[0] = callExpr
    }

    return Reflect.apply(func, this, args)
  }

  function parseStatement(func, args) {
    const [, topLevel] = args

    if (this.type === tt._import) {
      const { start, type } = lookahead(this)

      if (type === tt.dot ||
          type === tt.parenL) {
        const node = this.startNode()
        const expr = this.parseMaybeAssign()

        return this.parseExpressionStatement(node, expr)
      }

      if (! this.inModule ||
          (! topLevel &&
           ! this.options.allowImportExportEverywhere)) {
        let message

        if (type === tt.name) {
          message = UNEXPECTED_IDENTIFIER
        } else if (type === tt.string) {
          message = UNEXPECTED_STRING
        } else {
          message = UNEXPECTED_TOKEN + " " + type.label
        }

        this.raise(start, message)
      }
    }

    return Reflect.apply(func, this, args)
  }

  function parseImportCallAtom(parser) {
    const node = parser.startNode()

    parser.expect(tt._import)
    return parser.finishNode(node, "Import")
  }

  function parseImportMetaPropertyAtom(parser) {
    const node = parser.startNode()

    node.meta = parser.parseIdent(true)
    parser.expect(tt.dot)
    node.property = parser.parseIdent(true)

    if (node.property.name !== "meta") {
      parser.raise(node.property.start, UNEXPECTED_IDENTIFIER)
    } else if (! parser.inModule) {
      parser.raise(node.meta.start, ILLEGAL_IMPORT_META_OUTSIDE_MODULE)
    }

    return parser.finishNode(node, "MetaProperty")
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserImport
  : shared.module.acornParserImport = init()
