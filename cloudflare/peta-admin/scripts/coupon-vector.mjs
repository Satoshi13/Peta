// Only the public RFC 8032 test vector is used here; never load production secrets.
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/bundle.ts", import.meta.url), "utf8");
const validation = ts.transpileModule(await readFile(new URL("../src/validation.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const validationUrl = "data:text/javascript;base64," + Buffer.from(validation).toString("base64");
const js = ts.transpileModule(source.replace('"./validation"', JSON.stringify(validationUrl)), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { signBundle, CATALOG, checkGrants } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const input = JSON.parse(await readFile(new URL("../test/vector-input.json", import.meta.url)));
const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex").toString("base64");
const vector = { note: "Public RFC 8032 test vector, never a production key.", keyId: "c1", publicKey: "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=", event: await signBundle(input, "c1", seed), items: checkGrants(input.items), caps: CATALOG };
await writeFile(new URL("../test/coupon-vector.json", import.meta.url), JSON.stringify(vector, null, 2) + "\n");
console.log("Updated the public coupon contract vector.");
