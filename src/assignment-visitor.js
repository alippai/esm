import Parser from "./parser.js"
import Visitor from "./visitor.js"

class AssignmentVisitor extends Visitor {
  reset(rootPath, options) {
    this.exportedLocalNames = options.exportedLocalNames
    this.importedLocalNames = options.importedLocalNames
    this.magicString = options.magicString
    this.runtimeAlias = options.runtimeAlias

    if (this.exportedLocalNames === void 0) {
      this.exportedLocalNames = Object.create(null)
    }
  }

  visitAssignmentExpression(path) {
    this.visitChildren(path)
    assignmentHelper(this, path, "left")
  }

  visitCallExpression(path) {
    this.visitChildren(path)

    const callee = path.getValue().callee
    if (callee.type === "Identifier" &&
        callee.name === "eval") {
      wrap(this, path)
    }
  }

  visitUpdateExpression(path) {
    this.visitChildren(path)
    assignmentHelper(this, path, "argument")
  }
}

function assignmentHelper(visitor, path, childName) {
  let i = -1
  const child = path.getValue()[childName]
  const names = Parser.getNamesFromPattern(child)
  const nameCount = names.length

  // Perform checks, which may throw errors, before source transformations.
  while (++i < nameCount) {
    const name = names[i]

    if (visitor.importedLocalNames[name] === true &&
        ! isShadowed(path, name)) {
      throw new TypeError("Assignment to constant variable.")
    }
  }

  i = -1

  // Wrap assignments to exported identifiers with runtime.update().
  while (++i < nameCount) {
    const name = names[i]

    if (visitor.exportedLocalNames[name] === true &&
        ! isShadowed(path, name)) {
      wrap(visitor, path)
      return
    }
  }
}

function hasNamed(nodes, name) {
  let i = -1
  const nodeCount = nodes.length

  while (++i < nodeCount) {
    const node = nodes[i]
    const identifier = node.type === "VariableDeclarator" ? node.id : node

    if (identifier.name === name) {
      return true
    }
  }

  return false
}

function hasParam(node, name) {
  return hasNamed(node.params, name)
}

function hasVariable(node, name) {
  let i = -1
  const body = node.body
  const stmtCount = body.length

  while (++i < stmtCount) {
    const stmt = body[i]

    if (stmt.type === "VariableDeclaration" &&
        hasNamed(stmt.declarations, name)) {
      return true
    }
  }

  return false
}

function isShadowed(path, name) {
  let shadowed = false

  path.getParentNode((parent) => {
    const type = parent.type

    if ((type === "BlockStatement" && hasVariable(parent, name)) ||
        (type === "FunctionDeclaration" && hasParam(parent, name))) {
      return shadowed = true
    }

    return false
  })

  return shadowed
}

function wrap(visitor, path) {
  const node = path.getValue()

  visitor.magicString
    .prependRight(node.start, visitor.runtimeAlias + ".u(")
    .prependRight(node.end, ")")
}

export default AssignmentVisitor
