// SQL INJECTION GUARD. Reads every source file and fails if any database call has SQL text that is built
// from anything other than fixed constants. Values must always go through $1, $2... parameters.
//
// Allowed as the SQL argument:   "plain string"   `template with no ${}`   `${UPPER_SNAKE_CONSTANT} ...`   UPPER_SNAKE[...]
// Rejected:                      `... ${userInput} ...`   "..." + variable   sql   anything computed at run time
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

// The only two places allowed to pass a variable to query(), and why:
const EXEMPT = new Map([
  ["lib/db.ts", "the thin wrapper that forwards text + params to the pool"],
  ["db/migrate.ts", "runs the trusted .sql migration files from disk, never user input"],
]);

const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
const rootOf = (e: ts.Expression): ts.Expression => (ts.isElementAccessExpression(e) || ts.isPropertyAccessExpression(e) ? rootOf(e.expression) : e);

function isSafeSqlArg(arg: ts.Expression): boolean {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return true;
  if (ts.isTemplateExpression(arg)) return arg.templateSpans.every(span => ts.isIdentifier(span.expression) && CONSTANT.test(span.expression.text));
  const root = rootOf(arg);
  return ts.isIdentifier(root) && CONSTANT.test(root.text);   // CONSTANT or CONSTANT[...] (a lookup in a table of fixed queries)
}

export function findUnsafeQueries(source: string, fileName = "snippet.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (name === "query" && node.arguments.length > 0 && !isSafeSqlArg(node.arguments[0])) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        problems.push(`${fileName}:${line + 1}  ${node.arguments[0].getText().slice(0, 90)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));

describe("the guard itself catches injection-prone code", () => {
  const bad = [
    "query(`SELECT * FROM users WHERE email = '${email}'`)",
    "db.query('SELECT * FROM users WHERE id = ' + id)",
    "pool.query(sql)",
    "client.query(`SELECT * FROM t WHERE ${where}`, params)",
    "query(`SELECT ${columns} FROM t`)",
    "query(buildQuery(req.body))",
  ];
  const good = [
    "query('SELECT * FROM users WHERE email = $1', [email])",
    "db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])",
    "query(`${BASE_SELECT} WHERE ${SCOPE} ${ORDER}`, params)",
    "query(REQUEST_QUERIES[scope][which], params)",
    "query(FIXED_QUERY)",
  ];
  for (const code of bad) it(`flags:  ${code}`, () => assert.equal(findUnsafeQueries(code).length, 1));
  for (const code of good) it(`allows: ${code}`, () => assert.deepEqual(findUnsafeQueries(code), []));
});

describe("this project's source code", () => {
  it("never builds SQL text from variables", () => {
    const problems: string[] = [];
    let calls = 0;
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (EXEMPT.has(rel)) continue;
      const source = fs.readFileSync(file, "utf8");
      calls += (source.match(/\bquery\(/g) ?? []).length;
      problems.push(...findUnsafeQueries(source, rel));
    }
    assert.ok(calls > 30, `expected to find the project's queries, found only ${calls}`);   // makes sure the scan really looked at them
    assert.deepEqual(problems, [], `SQL built from variables (use $1 parameters instead):\n${problems.join("\n")}`);
  });
});
